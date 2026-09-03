import { ASSISTANT_DECISIONS } from "../tools/contracts";
import { getToolDefinition, isAssistantToolKey } from "../tools/registry";
import type { AgentConfigurationDocument } from "./contracts";

export function buildAgentActionSchema(
  configuration: AgentConfigurationDocument,
  allowToolRequest: boolean,
) {
  const finalAction = {
    type: "object",
    additionalProperties: false,
    required: ["type", "decision", "message", "groundingResultIds", "memory"],
    properties: {
      type: { type: "string", enum: ["final"] },
      decision: { type: "string", enum: ASSISTANT_DECISIONS },
      message: { type: "string" },
      groundingResultIds: { type: "array", maxItems: 10, items: { type: "string" } },
      memory: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "pendingQuestion", "nonSensitiveFacts"],
        properties: {
          summary: { type: "string" },
          pendingQuestion: { type: ["string", "null"] },
          nonSensitiveFacts: { type: "array", maxItems: 30, items: { type: "string" } },
        },
      },
    },
  };
  if (!allowToolRequest) return finalAction;

  const toolSchemas = configuration.enabledTools.filter(isAssistantToolKey).map((key) => ({
    type: "object",
    additionalProperties: false,
    required: ["name", "arguments"],
    properties: {
      name: { type: "string", enum: [key] },
      arguments: getToolDefinition(key).argumentsSchema,
    },
  }));
  const toolRequest = {
    type: "object",
    additionalProperties: false,
    required: ["type", "reasonCode", "toolCall"],
    properties: {
      type: { type: "string", enum: ["tool_request"] },
      reasonCode: {
        type: "string",
        enum: ["need_authoritative_data", "persist_customer_data", "perform_confirmed_action"],
      },
      toolCall: {
        anyOf: toolSchemas.length > 0
          ? toolSchemas
          : [{
              type: "object",
              additionalProperties: false,
              required: ["name", "arguments"],
              properties: {
                name: { type: "string", enum: ["no_tools_enabled"] },
                arguments: { type: "object", additionalProperties: false, required: [], properties: {} },
              },
            }],
      },
    },
  };
  return { anyOf: [toolRequest, finalAction] };
}