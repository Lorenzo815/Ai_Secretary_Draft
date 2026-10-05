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

const TOOL_REASON_CODES = [
  "need_authoritative_data",
  "persist_customer_data",
  "perform_confirmed_action",
] as const;

export function parseAgentAction(content: string): AgentAction {
  const envelope = JSON.parse(content) as { action?: Record<string, unknown> };
  const value = envelope.action;
  if (!value || typeof value !== "object") {
    throw new Error("O agente retornou um envelope de ação inválido.");
  }
  if (value.type === "tool_request") {
    const call = value.toolCall as {
      name?: unknown;
      argumentsJson?: unknown;
      arguments?: unknown;
    } | undefined;
    const reasonCode = value.reasonCode;
    const toolArguments = parseToolArguments(call?.argumentsJson ?? call?.arguments);
    if (
      !call || typeof call.name !== "string" || !isAssistantToolKey(call.name) ||
      typeof reasonCode !== "string" ||
      !TOOL_REASON_CODES.includes(reasonCode as typeof TOOL_REASON_CODES[number]) ||
      !toolArguments
    ) {
      throw new Error("O agente retornou uma solicitação de ferramenta inválida.");
    }
    return {
      type: "tool_request",
      reasonCode: reasonCode as typeof TOOL_REASON_CODES[number],
      toolCall: {
        tool: call.name,
        arguments: sanitizeObject(toolArguments, 0),
      },
    };
  }
  const decision = value.decision;
  const memory = value.memory as {
    summary?: unknown;
    pendingQuestion?: unknown;
    nonSensitiveFacts?: unknown;
  } | undefined;
  if (
    value.type !== "final" || typeof decision !== "string" ||
    !ASSISTANT_DECISIONS.includes(decision as typeof ASSISTANT_DECISIONS[number]) ||
    typeof value.message !== "string" || !Array.isArray(value.groundingResultIds) ||
    !memory || typeof memory.summary !== "string" ||
    (memory.pendingQuestion !== null && typeof memory.pendingQuestion !== "string") ||
    !Array.isArray(memory.nonSensitiveFacts)
  ) {
    throw new Error("O agente retornou uma resposta final inválida.");
  }
  return {
    type: "final",
    decision: decision as typeof ASSISTANT_DECISIONS[number],
    message: redactSensitiveText(value.message.trim()).slice(0, 4_096),
    groundingResultIds: value.groundingResultIds.filter((id): id is string => typeof id === "string").slice(0, 10),
    memory: {
      summary: redactSensitiveText(memory.summary.trim()).slice(0, 8_000),
      pendingQuestion: memory.pendingQuestion
        ? redactSensitiveText(memory.pendingQuestion.trim()).slice(0, 500)
        : null,
      nonSensitiveFacts: memory.nonSensitiveFacts
        .filter((fact): fact is string => typeof fact === "string")
        .map((fact) => redactSensitiveText(fact).slice(0, 500))
        .slice(0, 30),
    },
  };
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
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