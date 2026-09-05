import "server-only";

import { generateStructuredOutput } from "../../ai/structured-output";
import type { WhatsAppMessageDocument } from "../../whatsapp/messages";
import { ASSISTANT_DECISIONS } from "../tools/contracts";
import { isAssistantToolKey } from "../tools/registry";
import type { AgentAction, AgentConfigurationDocument, AgentRuntimeContext } from "./contracts";
import { buildAgentMessages, type AgentToolHistoryEntry } from "./prompt";
import { buildAgentActionSchema } from "./schema";

export async function generateAgentAction(input: {
  customerId: AgentRunCustomerId;
  configuration: AgentConfigurationDocument;
  runtime: AgentRuntimeContext;
  previousSummary: string;
  messages: WhatsAppMessageDocument[];
  toolHistory: AgentToolHistoryEntry[];
  finalIteration: boolean;
}) {
  return generateStructuredOutput({
    taskKey: "customer_agent",
    customerId: input.customerId,
    messages: buildAgentMessages(input),
    schemaName: "customer_agent_action",
    schema: buildAgentActionSchema(input.configuration, !input.finalIteration),
    trace: {
      configRevision: input.configuration.revision,
      configHash: input.configuration.contentHash,
      iteration: input.runtime.execution.iteration,
      finalIteration: input.finalIteration,
    },
    parse: parseAgentAction,
  });
}

type AgentRunCustomerId = import("mongodb").ObjectId;

function parseAgentAction(content: string): AgentAction {
  const envelope = JSON.parse(content) as { action?: Partial<AgentAction> };
  const value = envelope.action;
  if (!value || typeof value !== "object") {
    throw new Error("O agente retornou um envelope de ação inválido.");
  }
  if (value.type === "tool_request") {
    const call = value.toolCall as { name?: unknown; arguments?: unknown } | undefined;
    if (
      !call || typeof call.name !== "string" || !isAssistantToolKey(call.name) ||
      !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)
    ) {
      throw new Error("O agente retornou uma solicitação de ferramenta inválida.");
    }
    return {
      type: "tool_request",
      reasonCode: value.reasonCode!,
      toolCall: {
        tool: call.name,
        arguments: sanitizeObject(call.arguments as Record<string, unknown>, 0),
      },
    };
  }
  if (
    value.type !== "final" || !value.decision || !ASSISTANT_DECISIONS.includes(value.decision) ||
    typeof value.message !== "string" || !Array.isArray(value.groundingResultIds) ||
    !value.memory || typeof value.memory.summary !== "string" ||
    (value.memory.pendingQuestion !== null && typeof value.memory.pendingQuestion !== "string") ||
    !Array.isArray(value.memory.nonSensitiveFacts)
  ) {
    throw new Error("O agente retornou uma resposta final inválida.");
  }
  return {
    type: "final",
    decision: value.decision,
    message: redactSensitiveText(value.message.trim()).slice(0, 4_096),
    groundingResultIds: value.groundingResultIds.filter((id): id is string => typeof id === "string").slice(0, 10),
    memory: {
      summary: redactSensitiveText(value.memory.summary.trim()).slice(0, 8_000),
      pendingQuestion: value.memory.pendingQuestion
        ? redactSensitiveText(value.memory.pendingQuestion.trim()).slice(0, 500)
        : null,
      nonSensitiveFacts: value.memory.nonSensitiveFacts
        .filter((fact): fact is string => typeof fact === "string")
        .map((fact) => redactSensitiveText(fact).slice(0, 500))
        .slice(0, 30),
    },
  };
}

function sanitizeObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth >= 4) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [
    key.slice(0, 100),
    sanitizeValue(item, depth + 1),
  ]));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") return sanitizeObject(value as Record<string, unknown>, depth);
  return null;
}

function redactSensitiveText(value: string) {
  return value.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF REDACTED]");
}