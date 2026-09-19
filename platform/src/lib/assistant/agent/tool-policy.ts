import "server-only";

import { executeToolCalls, wasToolSuccessfullyExecuted } from "../tools/execution";
import { getToolDefinition, isAssistantToolKey } from "../tools/registry";
import type { ToolExecutionContext } from "../tools/contracts";
import type { AgentConfigurationDocument, AgentToolRequest } from "./contracts";

export async function executeAgentTool(input: {
  request: AgentToolRequest;
  configuration: AgentConfigurationDocument;
  context: Omit<ToolExecutionContext, "configuration">;
}) {
  const key = input.request.toolCall.tool;
  if (!isAssistantToolKey(key) || !input.configuration.enabledTools.includes(key)) {
    return denied("tool_not_enabled", "Esta ferramenta não está habilitada na configuração ativa.");
  }
  const mutation = getToolDefinition(key).mutates;
  const execution = await executeToolCalls({
    calls: [input.request.toolCall],
    allowedTools: input.configuration.enabledTools,
    context: { ...input.context, configuration: input.configuration },
  });
  return {
    output: execution?.output ?? JSON.stringify({ executedTools: [], results: [] }),
    retryable: execution?.retryable ?? false,
    mutation: mutation && wasToolSuccessfullyExecuted(execution?.output, key),
    denied: false,
  };
}

function denied(code: string, message: string) {
  return {
    output: JSON.stringify({
      executedTools: [],
      results: [{ ok: false, type: "policy_denied", code, message }],
    }),
    retryable: false,
    mutation: false,
    denied: true,
  };
}