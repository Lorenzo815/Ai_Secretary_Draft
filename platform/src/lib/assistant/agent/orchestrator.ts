import "server-only";

import { ObjectId } from "mongodb";
import { findCustomerById, updateCustomerServiceStatus } from "../../crm";
import { sendTextMessage } from "../../whatsapp/client";
import { saveWhatsAppMessage } from "../../whatsapp/messages";
import type { AutomationJobDocument } from "../../automation/contracts";
import {
  claimAutomationJob,
  completeAutomationJob,
  failAutomationJob,
  isAutomationJobCurrent,
} from "../../automation/queue";
import { loadAssistantContext, saveAssistantContext } from "../context";
import { getAssistantConfig } from "../config";
import { getGroundedToolReply, wasToolSuccessfullyExecuted } from "../tools/execution";
import { generateAgentAction } from "./model";
import { getAgentConfiguration } from "./repository";
import { buildAgentRuntimeContext } from "./runtime-context";
import { finishAgentRun, recordAgentRunStep, startAgentRun } from "./runs";
import { executeAgentTool } from "./tool-policy";
import { getAgentFinalMessage } from "./final-response";
import type { AgentFinalResponse } from "./contracts";
import type { AgentToolHistoryEntry } from "./prompt";

export async function processNextAssistantJob() {
  const runtimeConfig = getAssistantConfig();
  const job = await claimAutomationJob(runtimeConfig.leaseMs, "customer_agent");
  if (!job) return { processed: false as const };

  return processCustomerAgentJob(job);
}

export async function processCustomerAgentJob(job: AutomationJobDocument) {
  const runtimeConfig = getAssistantConfig();

  const configuration = await getAgentConfiguration();
  let run: Awaited<ReturnType<typeof startAgentRun>> | undefined;
  let modelIterations = 0;
  let toolExecutions = 0;
  let mutationsExecuted = 0;

  try {
    const context = await loadAssistantContext(job.customerId, runtimeConfig.recentMessageLimit);
    const customer = await findCustomerById(job.customerId.toString());
    const latestInbound = [...context.messages].reverse().find((message) => message.direction === "inbound");
    if (!configuration.enabled || !customer || !latestInbound) {
      await completeAutomationJob(job._id, job.revision);
      return { processed: true as const, skipped: !configuration.enabled ? "agent_disabled" : "missing_context" };
    }
    if (["waiting_human", "human_active", "closed"].includes(customer.serviceStatus ?? "ai_active")) {
      await completeAutomationJob(job._id, job.revision);
      return { processed: true as const, skipped: "customer_not_ai_active" };
    }
    if (!latestInbound.contactPhone) {
      await completeAutomationJob(job._id, job.revision);
      return { processed: true as const, skipped: "no_routing_data" };
    }

    run = await startAgentRun({ customerId: job.customerId, jobRevision: job.revision, configuration });
    const toolHistory: AgentToolHistoryEntry[] = [];
    const invalidFingerprints = new Map<string, number>();

    for (let iteration = 1; iteration <= configuration.loopPolicy.maxModelIterations; iteration += 1) {
      if (!(await isAutomationJobCurrent(job._id, job.revision))) {
        await finishAgentRun({
          runId: run._id,
          status: "superseded",
          modelIterations,
          toolExecutions,
          mutationsExecuted,
        });
        await completeAutomationJob(job._id, job.revision);
        return { processed: true as const, skipped: "newer_message_arrived" };
      }

      const refreshedCustomer = await findCustomerById(job.customerId.toString());
      if (!refreshedCustomer) throw new Error("Cliente não encontrado durante a execução do agente.");
      const runtime = await buildAgentRuntimeContext({
        customer: refreshedCustomer,
        configuration,
        iteration,
        toolExecutions,
        mutationsExecuted,
      });
      const generated = await generateAgentAction({
        customerId: job.customerId,
        configuration,
        runtime,
        previousSummary: context.summary,
        messages: context.messages,
        toolHistory,
        finalIteration: iteration === configuration.loopPolicy.maxModelIterations,
      });
      modelIterations += 1;
      const action = generated.value;

      if (action.type === "tool_request") {
        const activeOption = runtime.operations.activeSchedulingOption as { optionId?: string } | null;
        const execution = await executeAgentTool({
          request: action,
          configuration,
          context: {
            customerId: job.customerId,
            customerName: latestInbound.contactName ?? latestInbound.contactPhone,
            contactPhone: latestInbound.contactPhone,
            activeSchedulingOptionId: activeOption?.optionId,
            isMutationAllowed: () => isAutomationJobCurrent(job._id, job.revision),
          },
          toolExecutions,
          mutationsExecuted,
        });
        toolExecutions += 1;
        if (execution.mutation) mutationsExecuted += 1;
        const resultId = new ObjectId().toHexString();
        const parsedResult = parseToolResult(execution.output);
        toolHistory.push({ resultId, request: action, result: parsedResult });
        await recordAgentRunStep({
          runId: run._id,
          customerId: job.customerId,
          iteration,
          action,
          toolResult: { resultId, result: parsedResult },
        });

        const groundedReply = getGroundedToolReply(execution.output);
        if (
          groundedReply &&
          (action.toolCall.tool === "calendar.book" || action.toolCall.tool === "calendar.reschedule") &&
          wasToolSuccessfullyExecuted(execution.output, action.toolCall.tool)
        ) {
          return finalize({
            response: {
              type: "final",
              decision: "reply",
              message: groundedReply,
              groundingResultIds: [resultId],
              memory: {
                summary: `${context.summary}\n${groundedReply}`.trim(),
                pendingQuestion: null,
                nonSensitiveFacts: [groundedReply],
              },
            },
            groundedReply,
            latestInbound,
            context,
            job,
            run,
            modelIterations,
            toolExecutions,
            mutationsExecuted,
            iteration: iteration + 1,
          });
        }

        if (execution.retryable) {
          const fingerprint = JSON.stringify(action.toolCall);
          const failures = (invalidFingerprints.get(fingerprint) ?? 0) + 1;
          invalidFingerprints.set(fingerprint, failures);
          if (failures > configuration.loopPolicy.maxRepeatedInvalidCalls) {
            return finalize({
              response: recoveryHandoff(context.summary),
              groundedReply: null,
              latestInbound,
              context,
              job,
              run,
              modelIterations,
              toolExecutions,
              mutationsExecuted,
              iteration,
            });
          }
        }
        continue;
      }

      const knownResultIds = new Set(toolHistory.map((entry) => entry.resultId));
      action.groundingResultIds = action.groundingResultIds.filter((id) => knownResultIds.has(id));
      const latestToolOutput = toolHistory.length > 0
        ? JSON.stringify(toolHistory.at(-1)?.result)
        : undefined;
      return finalize({
        response: action,
        groundedReply: getGroundedToolReply(latestToolOutput),
        latestInbound,
        context,
        job,
        run,
        modelIterations,
        toolExecutions,
        mutationsExecuted,
        iteration,
      });
    }

    throw new Error("O agente encerrou o limite de iterações sem uma resposta final.");
  } catch (error) {
    if (run) {
      await finishAgentRun({
        runId: run._id,
        status: "failed",
        modelIterations,
        toolExecutions,
        mutationsExecuted,
        error,
      }).catch((runError) => console.error("Agent run could not be failed", runError));
    }
    await failAutomationJob(job, error);
    throw error;
  }
}

async function finalize(input: {
  response: AgentFinalResponse;
  groundedReply: string | null;
  latestInbound: Awaited<ReturnType<typeof loadAssistantContext>>["messages"][number];
  context: Awaited<ReturnType<typeof loadAssistantContext>>;
  job: AutomationJobDocument;
  run: Awaited<ReturnType<typeof startAgentRun>>;
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
  iteration: number;
}) {
  if (!(await isAutomationJobCurrent(input.job._id, input.job.revision))) {
    await finishAgentRun({
      runId: input.run._id,
      status: "superseded",
      modelIterations: input.modelIterations,
      toolExecutions: input.toolExecutions,
      mutationsExecuted: input.mutationsExecuted,
    });
    await completeAutomationJob(input.job._id, input.job.revision);
    return { processed: true as const, skipped: "newer_message_arrived" };
  }
  const body = getAgentFinalMessage(input.response, input.groundedReply);
  if (input.response.decision === "human_handoff" || input.response.decision === "emergency") {
    await updateCustomerServiceStatus(input.job.customerId, "waiting_human");
  }
  const sent = await sendTextMessage({ to: input.latestInbound.contactPhone, body });
  await saveWhatsAppMessage({
    customerId: input.job.customerId,
    metaMessageId: sent.messageId,
    contactPhone: input.latestInbound.contactPhone,
    contactName: input.latestInbound.contactName,
    direction: "outbound",
    type: "text",
    body,
    status: "sent",
    timestamp: new Date(),
  });
  await saveAssistantContext({
    customerId: input.job.customerId,
    summary: input.response.memory.summary,
    pendingQuestion: input.response.memory.pendingQuestion,
    nonSensitiveFacts: input.response.memory.nonSensitiveFacts,
    summarizedThrough: input.job.latestEventAt,
  });
  await recordAgentRunStep({
    runId: input.run._id,
    customerId: input.job.customerId,
    iteration: input.iteration,
    action: { ...input.response, message: body },
  });
  await finishAgentRun({
    runId: input.run._id,
    status: "completed",
    modelIterations: input.modelIterations,
    toolExecutions: input.toolExecutions,
    mutationsExecuted: input.mutationsExecuted,
    finalDecision: input.response.decision,
  });
  await completeAutomationJob(input.job._id, input.job.revision);
  return { processed: true as const, decision: input.response.decision };
}

function parseToolResult(output: string) {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return { executedTools: [], results: [{ ok: false, type: "operational_error" }] };
  }
}

function recoveryHandoff(summary: string): AgentFinalResponse {
  return {
    type: "final",
    decision: "human_handoff",
    message: "",
    groundingResultIds: [],
    memory: {
      summary: `${summary}\nA ferramenta não pôde ser validada dentro do limite do atendimento.`,
      pendingQuestion: null,
      nonSensitiveFacts: [],
    },
  };
}