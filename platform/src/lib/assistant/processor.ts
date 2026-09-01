import "server-only";

import { getAssistantConfig } from "./config";
import { loadAssistantContext, saveAssistantContext } from "./context";
import { generateAssistantResponse } from "./azure-openai";
import { getSafeReply, redactToolCallsForAudit } from "./prompt";
import {
  assertRequiredToolCall,
  executeToolCalls,
  getGroundedToolReply,
  getToolValidationRecoveryReply,
  hasSuccessfulToolResult,
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
import { findCustomerById, getCustomerProfileSnapshot, updateCustomerServiceStatus } from "../crm";
import { canContinueImmediately } from "./transition";
import { ensureExplicitNextQuestion, preventPrematureJourneyCompletion } from "./dialogue";
import { hasBookedFirstVisit } from "../calendar";

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
    if (!runtime && latestInbound) {
      const settings = await getAssistantSettings();
      await assignCustomerFlow(
        job.customerId,
        settings.defaultFlowKey,
        "assistant",
        "Nova mensagem recebida após a conclusão do fluxo anterior",
      );
      runtime = await getFlowRuntime(job.customerId);
    }
    const contactPhone = latestInbound?.contactPhone;
    const contactName = latestInbound?.contactName;
    if (!contactPhone || !runtime) {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: runtime ? "no_routing_data" : "flow_completed" };
    }

    let generation = await generateAssistantResponse({
      ...context,
      flow: runtime.definition,
      version: runtime.version,
      assignment: runtime.assignment,
      customerProfile: getCustomerProfileSnapshot(customer),
      customerId: job.customerId,
    });
    let modelCallCount = 1;
    if (!(await isAssistantJobRevisionCurrent(job._id, job.revision))) {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: "newer_message_arrived" };
    }
    while (canContinueImmediately({
      transition: generation.transition,
      toolCalls: generation.toolCalls,
      allowedTransitions: runtime.version.allowedTransitions,
      modelCallCount,
      maxModelCalls: 2,
    })) {
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
        toolCalls: redactToolCallsForAudit(generation.toolCalls),
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
        customerProfile: getCustomerProfileSnapshot(customer),
        customerId: job.customerId,
      });
      modelCallCount += 1;
    }
    let toolCalls = generation.toolCalls;
    let toolResult: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let execution = await executeToolCalls({
        calls: toolCalls,
        allowedTools: runtime.version.allowedTools,
        context: {
          customerId: job.customerId,
          customerName: contactName ?? contactPhone,
          contactPhone,
        },
      });
      execution ??= assertRequiredToolCall({
        generation,
        allowedTools: runtime.version.allowedTools,
        completionIsGrounded: generation.transition.action === "complete"
          && runtime.definition.key === "schedule_appointment"
          && await hasBookedFirstVisit(job.customerId),
      });
      if (!execution) break;

      toolResult = execution.output;
      if (modelCallCount >= 2) {
        if (execution.retryable) {
          generation = {
            ...generation,
            decision: "reply",
            reply: getToolValidationRecoveryReply(runtime.definition.key),
            updatedSummary: `${generation.updatedSummary}\nAguardando o cliente reenviar ou confirmar a informação da etapa atual.`,
            transition: {
              action: "stay",
              continueImmediately: false,
              targetFlowKey: undefined,
              reasonCode: "tool_validation_retry_exhausted",
              reason: "A chamada de ferramenta permaneceu inválida após a correção permitida.",
            },
            toolCalls: [],
          };
        }
        break;
      }
      const refreshedCustomer = await findCustomerById(job.customerId.toString());
      generation = await generateAssistantResponse({
        ...context,
        flow: runtime.definition,
        version: runtime.version,
        assignment: runtime.assignment,
        toolResult,
        phase: execution.retryable ? "pre_tool" : "post_tool",
        customerProfile: getCustomerProfileSnapshot(refreshedCustomer ?? customer),
        customerId: job.customerId,
      });
      modelCallCount += 1;
      if (!execution.retryable) break;
      if (attempt === 2) {
        throw new Error("A IA excedeu o limite de correções de tools.");
      }
      toolCalls = generation.toolCalls;
    }
    const groundedToolReply = getGroundedToolReply(toolResult);
    const firstVisitBooked = hasSuccessfulToolResult(toolResult, "calendar.book_first_visit");
    if (firstVisitBooked) {
      generation = {
        ...generation,
        transition: {
          action: "complete",
          continueImmediately: false,
          targetFlowKey: undefined,
          reasonCode: "first_visit_booked",
          reason: "Bioimpedância e Consulta Dr. confirmadas pela ferramenta como um único grupo de visita.",
        },
      };
    }
    if (groundedToolReply) {
      generation = {
        ...generation,
        decision: "reply",
        reply: groundedToolReply,
        updatedSummary: `${generation.updatedSummary}\nResultado confirmado por tool: ${groundedToolReply}`,
      };
    }
    if (!(await isAssistantJobRevisionCurrent(job._id, job.revision))) {
      await completeAssistantJob(job._id, job.revision);
      return { processed: true as const, skipped: "newer_message_arrived" };
    }

    const finalCustomer = await findCustomerById(job.customerId.toString());
    const finalProfile = getCustomerProfileSnapshot(finalCustomer ?? customer);
    generation = {
      ...generation,
      transition: preventPrematureJourneyCompletion({
        decision: generation.decision,
        transition: generation.transition,
        flowKey: runtime.definition.key,
        relationshipStatus: finalProfile.relationshipStatus,
        missingFields: finalProfile.missingFields,
      }),
    };
    const body = ensureExplicitNextQuestion({
      reply: getSafeReply(generation),
      decision: generation.decision,
      transitionAction: generation.transition.action,
      targetFlowKey: generation.transition.targetFlowKey,
      flowKey: runtime.definition.key,
      missingFields: finalProfile.missingFields,
      toolResult,
    });
    if (generation.decision === "human_handoff" || generation.decision === "emergency") {
      await updateCustomerServiceStatus(job.customerId, "waiting_human");
    }
    const sent = await sendTextMessage({ to: contactPhone, body });

    await saveWhatsAppMessage({
      customerId: job.customerId,
      metaMessageId: sent.messageId,
      contactPhone,
      contactName,
      direction: "outbound",
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
      toolCalls: redactToolCallsForAudit(toolCalls),
      toolResult: toolResult ?? undefined,
    });
    await applyFlowResult({
      customerId: job.customerId,
      flowKey: runtime.definition.key,
      flowVersion: runtime.version.version,
      state: generation.state,
      transition: generation.transition,
    });
    if (firstVisitBooked) {
      await updateCustomerServiceStatus(job.customerId, "closed");
    }
    await completeAssistantJob(job._id, job.revision);
    if (
      finalProfile.missingFields.length === 0
      && ["commercial_information", "payment_confirmation", "schedule_appointment"].includes(runtime.definition.key)
    ) {
      try {
        const { analyzeAndSaveCustomerLeadQualification } = await import("../qualification/customer-lead");
        await analyzeAndSaveCustomerLeadQualification(job.customerId);
      } catch (qualificationError) {
        console.error("Lead qualification refresh failed after assistant response", qualificationError);
      }
    }
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
