import type { FlowVersion } from "./flows";
import { ASSISTANT_DECISIONS } from "./tools/contracts";
import { getToolDefinition, isAssistantToolKey } from "./tools/registry";

export type AssistantCallPhase = "single" | "pre_tool" | "post_tool";

export function buildAssistantResponseSchema(version: FlowVersion, phase: AssistantCallPhase) {
  const allowedTools = phase === "pre_tool"
    ? version.allowedTools.filter(isAssistantToolKey)
    : [];
  const toolCallSchemas = allowedTools.map((key) => ({
    type: "object",
    additionalProperties: false,
    required: ["tool", "arguments"],
    properties: {
      tool: { type: "string", enum: [key] },
      arguments: getToolDefinition(key).argumentsSchema,
    },
  }));

  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reply", "updatedSummary", "state", "transition", "toolCalls"],
    properties: {
      decision: { type: "string", enum: ASSISTANT_DECISIONS },
      reply: { type: "string" },
      updatedSummary: { type: "string" },
      state: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "collectedData", "missingData", "notes"],
        properties: {
          stage: { type: "string" },
          collectedData: {
            type: "array",
            maxItems: 0,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: {
                key: { type: "string" },
                value: { type: "string" },
              },
            },
          },
          missingData: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
      },
      transition: {
        type: "object",
        additionalProperties: false,
        required: ["action", "continueImmediately", "targetFlowKey", "reasonCode", "reason"],
        properties: {
          action: { type: "string", enum: ["stay", "complete", "transition"] },
          continueImmediately: { type: "boolean" },
          targetFlowKey: { type: ["string", "null"], enum: [...version.allowedTransitions, null] },
          reasonCode: { type: ["string", "null"] },
          reason: { type: ["string", "null"] },
        },
      },
      toolCalls: {
        type: "array",
        minItems: 0,
        maxItems: phase === "pre_tool" ? 2 : 0,
        items: toolCallSchemas.length > 0
          ? { anyOf: toolCallSchemas }
          : { type: "object", additionalProperties: false, required: [], properties: {} },
      },
    },
  };
}
