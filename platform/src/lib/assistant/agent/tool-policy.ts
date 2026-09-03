import "server-only";

import { executeToolCalls } from "../tools/execution";
import { getToolDefinition, isAssistantToolKey } from "../tools/registry";
import type { ToolExecutionContext } from "../tools/contracts";
import type { AgentConfigurationDocument, AgentToolRequest } from "./contracts";

export async function executeAgentTool(input: {
  request: AgentToolRequest;
  configuration: AgentConfigurationDocument;
  context: Omit<ToolExecutionContext, "configuration">;
  toolExecutions: number;
  mutationsExecuted: number;
}) {
  const key = input.request.toolCall.tool;
  if (!isAssistantToolKey(key) || !input.configuration.enabledTools.includes(key)) {
    return denied("tool_not_enabled", "Esta ferramenta não está habilitada na configuração ativa.");
  }
  if (input.toolExecutions >= input.configuration.loopPolicy.maxToolExecutions) {
    return denied("tool_budget_exhausted", "O limite de ferramentas deste atendimento foi atingido.");
  }
  const mutation = getToolDefinition(key).mutates;
  if (mutation && input.mutationsExecuted >= input.configuration.loopPolicy.maxMutations) {
    return denied("mutation_budget_exhausted", "O limite de alterações deste atendimento foi atingido.");
  }
  const execution = await executeToolCalls({
    calls: [input.request.toolCall],
    allowedTools: input.configuration.enabledTools,
    context: { ...input.context, configuration: input.configuration },
  });
  return {
    output: execution?.output ?? JSON.stringify({ executedTools: [], results: [] }),
    retryable: execution?.retryable ?? false,
    mutation,
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