import "server-only";

import { randomUUID } from "crypto";
import { getAssistantConfig } from "./config";
import { loadAssistantContext, saveAssistantContext } from "./context";
import { generateAssistantResponse } from "./azure-openai";
import { getSafeReply } from "./prompt";
import {
  assertCalendarToolCall,
  executeCalendarAction,
  getGroundedCalendarReply,
  resolveCalendarAction,
} from "./tools";
import {
  applyFlowResult,
  assignCustomerFlow,
  getAssistantSettings,
  getFlowRuntime,
  recordFlowRun,
} from "./flows";
import {
  claimAssistantJob,
  completeAssistantJob,
  failAssistantJob,
  isAssistantJobRevisionCurrent,
} from "./queue";
import { sendTextMessage } from "../whatsapp/client";
import { saveWhatsAppMessage } from "../whatsapp/messages";
import { updateCustomerServiceStatus } from "../crm";
import { findCustomerById } from "../crm";
import { completeAwaitingFollowUpTrigger, markFollowUpTriggerAwaitingResponse } from "../calendar";

export async function processNextAssistantJob() {
  const config = getAssistantConfig();
  const job = await claimAssistantJob(config.leaseMs);
  if (!job) return { processed: false as const };

  try {
    const context = await loadAssistantContext(job.customerId, config.recentMessageLimit);
    let runtime = await getFlowRuntime(job.customerId);
    const customer = await findCustomerById(job.customerId.toString());
    const latestInbound = [...context.messages]
      .reverse()
      .find((message) => message.direction === "inbound");

    if (!customer || customer.serviceStatus === "waiting_human" || customer.serviceStatus === "human_active" || customer.serviceStatus === "closed") {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: "customer_not_ai_active" };
    }
    if (!runtime && latestInbound && !job.triggerContext) {
      const settings = await getAssistantSettings();
      await assignCustomerFlow(
        job.customerId,
        settings.defaultFlowKey,
        "assistant",
        "Nova mensagem recebida após a conclusão do fluxo anterior",
      );
      runtime = await getFlowRuntime(job.customerId);
    }
    const contactPhone = latestInbound?.contactPhone ?? job.targetContactPhone;
    const contactName = latestInbound?.contactName ?? job.targetContactName;
    const messageSource = latestInbound?.source ?? job.targetMessageSource;
    if (!contactPhone || !messageSource || !runtime) {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: runtime ? "no_routing_data" : "flow_completed" };
    }

    let generation = await generateAssistantResponse({
      ...context,
      flow: runtime.definition,
      version: runtime.version,
      assignment: runtime.assignment,
      triggerContext: job.triggerContext,
    });
    let modelCallCount = 1;
    if (!(await isAssistantJobRevisionCurrent(job._id, job.revision))) {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: "newer_message_arrived" };
    }
    while (
      generation.transition.action === "transition" &&
      generation.transition.continueImmediately === true &&
      generation.transition.targetFlowKey &&
      runtime.version.allowedTransitions.includes(generation.transition.targetFlowKey) &&
      modelCallCount < 2
    ) {
      await recordFlowRun({
        customerId: job.customerId,
        jobRevision: job.revision,
        flowKey: runtime.definition.key,
        flowVersion: runtime.version.version,
        decision: generation.decision,
        deliveryStatus: "internal_transition",
        reply: generation.reply,
        state: generation.state,
        transition: generation.transition,
        calendarAction: generation.calendarAction,
      });
      await applyFlowResult({
        customerId: job.customerId,
        flowKey: runtime.definition.key,
        flowVersion: runtime.version.version,
        state: generation.state,
        transition: generation.transition,
      });
      runtime = await getFlowRuntime(job.customerId);
      if (!runtime) throw new Error("O fluxo de destino não está disponível.");
      generation = await generateAssistantResponse({
        ...context,
        flow: runtime.definition,
        version: runtime.version,
        assignment: runtime.assignment,
        triggerContext: job.triggerContext,
      });
      modelCallCount += 1;
    }
    let calendarAction = resolveCalendarAction(generation, runtime.version.allowedTools);
    let calendarToolResult: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let execution = await executeCalendarAction({
        action: calendarAction,
        allowedTools: runtime.version.allowedTools,
        customerId: job.customerId,
        customerName: contactName ?? contactPhone,
        contactPhone,
        messageSource,
      });
      execution ??= await assertCalendarToolCall({
        generation,
        allowedTools: runtime.version.allowedTools,
      });
      if (!execution) break;

      calendarToolResult = execution.output;
      if (modelCallCount >= 2) {
        if (execution.retryable) {
          throw new Error("A IA não produziu uma chamada de ferramenta válida dentro do limite de duas chamadas.");
        }
        break;
      }
      generation = await generateAssistantResponse({
        ...context,
        flow: runtime.definition,
        version: runtime.version,
        assignment: runtime.assignment,
        triggerContext: job.triggerContext,
        calendarToolResult,
        phase: execution.retryable ? "pre_tool" : "post_tool",
      });
      modelCallCount += 1;
      if (!execution.retryable) break;
      if (attempt === 2) {
        throw new Error("A IA excedeu o limite de correções da ferramenta de calendário.");
      }
      calendarAction = resolveCalendarAction(generation, runtime.version.allowedTools);
    }
    const groundedCalendarReply = getGroundedCalendarReply(calendarToolResult);
    if (groundedCalendarReply) {
      generation = {
        ...generation,
        decision: "reply",
        reply: groundedCalendarReply,
        updatedSummary: `${generation.updatedSummary}\nResultado confirmado da agenda: ${groundedCalendarReply}`,
      };
    }
    if (job.triggerContext && runtime.definition.key === "follow_up") {
      generation = {
        ...generation,
        state: {
          ...generation.state,
          stage: "aguardando_confirmacao_cliente",
          missingData: [...new Set([...generation.state.missingData, "customer_confirmation"])],
          notes: [...generation.state.notes, "Lembrete enviado; aguardando resposta do cliente."],
        },
        transition: { action: "stay" },
      };
    }
    if (
      runtime.definition.key === "follow_up" &&
      !job.triggerContext &&
      generation.transition.action === "complete" &&
      generation.decision !== "human_handoff" &&
      generation.decision !== "emergency" &&
      isAppointmentConfirmation(runtime.assignment.state) &&
      !hasAffirmativeCustomerConfirmation(generation.state)
    ) {
      const confirmation = getCustomerConfirmation(generation.state);
      generation = {
        ...generation,
        state: {
          ...generation.state,
          stage: confirmation
            ? "aguardando_destino_apos_recusa"
            : "aguardando_confirmacao_cliente",
          missingData: [...new Set([
            ...generation.state.missingData,
            confirmation ? "next_action" : "customer_confirmation",
          ])],
          notes: [...generation.state.notes, "Follow-up mantido ativo até a confirmação afirmativa ou definição do próximo atendimento."],
        },
        transition: { action: "stay" },
      };
    }
    if (!(await isAssistantJobRevisionCurrent(job._id, job.revision))) {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: "newer_message_arrived" };
    }

    const body = getSafeReply(generation);
    if (generation.decision === "human_handoff" || generation.decision === "emergency") {
      await updateCustomerServiceStatus(job.customerId, "waiting_human");
    }
    const sent = messageSource === "simulator"
      ? { messageId: `wamid.simulated.ai.${randomUUID()}` }
      : await sendTextMessage({ to: contactPhone, body });

    await saveWhatsAppMessage({
      customerId: job.customerId,
      metaMessageId: sent.messageId,
      contactPhone,
      contactName,
      direction: "outbound",
      source: messageSource,
      type: "text",
      body,
      status: "sent",
      timestamp: new Date(),
    });
    await saveAssistantContext({
      customerId: job.customerId,
      summary: `${generation.updatedSummary}\nÚltima resposta enviada: ${body}`,
      summarizedThrough: job.latestInboundAt,
    });
    if (job.followUpTriggerId) {
      await markFollowUpTriggerAwaitingResponse(job.followUpTriggerId);
    }
    await recordFlowRun({
      customerId: job.customerId,
      jobRevision: job.revision,
      flowKey: runtime.definition.key,
      flowVersion: runtime.version.version,
      decision: generation.decision,
      deliveryStatus: "sent",
      reply: body,
      state: generation.state,
      transition: generation.transition,
      calendarAction,
      calendarToolResult: calendarToolResult ?? undefined,
    });
    await applyFlowResult({
      customerId: job.customerId,
      flowKey: runtime.definition.key,
      flowVersion: runtime.version.version,
      state: generation.state,
      transition: generation.transition,
    });
    if (
      runtime.definition.key === "follow_up" &&
      !job.triggerContext &&
      generation.transition.action === "complete"
    ) {
      await completeAwaitingFollowUpTrigger(job.customerId);
    }
    await completeAssistantJob(job._id, job.revision);
    return {
      processed: true as const,
      decision: generation.decision,
      flow: runtime.definition.key,
      transition: generation.transition.action,
    };
  } catch (error) {
    await failAssistantJob(job, error);
    throw error;
  }
}

function isAppointmentConfirmation(state: { collectedData: Array<{ key: string }> }) {
  return state.collectedData.some((item) => item.key === "appointmentId");
}

function getCustomerConfirmation(state: { collectedData: Array<{ key: string; value: string }> }) {
  return state.collectedData.find((item) => item.key === "customer_confirmation")?.value.trim() ?? "";
}

function hasAffirmativeCustomerConfirmation(state: { collectedData: Array<{ key: string; value: string }> }) {
  const normalized = getCustomerConfirmation(state)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized || /\b(nao|negativ|recus|cancel|reagend)\w*\b/.test(normalized)) return false;
  return /\b(sim|confirmo|confirmad[oa]|presenca confirmada)\b/.test(normalized);
}