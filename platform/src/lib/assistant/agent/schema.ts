import { ASSISTANT_DECISIONS } from "../tools/contracts";
import { isAssistantToolKey } from "../tools/registry";
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
  if (!allowToolRequest) return wrapActionSchema(finalAction);

  const toolNames = configuration.enabledTools.filter(isAssistantToolKey);
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
        type: "object",
        additionalProperties: false,
        required: ["name", "argumentsJson"],
        properties: {
          name: { type: "string", enum: toolNames.length > 0 ? toolNames : ["no_tools_enabled"] },
          argumentsJson: {
            type: "string",
            description: "Objeto JSON serializado com os argumentos da ferramenta escolhida.",
          },
        },
      },
    },
  };
  return wrapActionSchema({ anyOf: [toolRequest, finalAction] });
}

function wrapActionSchema(actionSchema: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: { action: actionSchema },
  };
}