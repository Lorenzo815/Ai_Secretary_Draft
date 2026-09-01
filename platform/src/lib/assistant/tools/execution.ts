import "server-only";

import type { AssistantGeneration } from "../prompt";
import type { AssistantToolKey } from "./registry";
import type { ToolCall, ToolExecution, ToolExecutionContext } from "./contracts";
import { getToolDefinition, isAssistantToolKey } from "./registry";

export async function executeToolCalls(input: {
  calls: ToolCall[];
  allowedTools: AssistantToolKey[];
  context: ToolExecutionContext;
}): Promise<ToolExecution | null> {
  const calls = input.calls.slice(0, 2);
  const mutationIndexes = calls.flatMap((call, index) => (
    isAssistantToolKey(call.tool) && getToolDefinition(call.tool).mutates ? [index] : []
  ));
  if (mutationIndexes.length > 1 || mutationIndexes.some((index) => index !== calls.length - 1)) {
    return executionError("invalid_sequence", "Use no máximo uma tool que altere dados e coloque-a por último.");
  }

  const results: unknown[] = [];
  const executedTools: AssistantToolKey[] = [];
  let retryable = false;
  for (const call of calls) {
    if (!isAssistantToolKey(call.tool) || !input.allowedTools.includes(call.tool)) {
      results.push(errorResult(call.tool, "tool_not_allowed", "Esta tool não está autorizada no fluxo atual."));
      retryable = true;
      break;
    }
    const resolved = resolvePreviousReferences(call.arguments, results.at(-1));
    if (!resolved.ok) {
      results.push(errorResult(call.tool, "invalid_reference", resolved.error));
      retryable = true;
      break;
    }
    const startedAt = Date.now();
    console.info("Assistant tool call started", {
      tool: call.tool,
      customerId: input.context.customerId.toString(),
      argumentKeys: Object.keys(resolved.value),
    });
    const execution = await getToolDefinition(call.tool).execute(input.context, resolved.value);
    console.info("Assistant tool call completed", {
      tool: call.tool,
      customerId: input.context.customerId.toString(),
      durationMs: Date.now() - startedAt,
      retryable: execution?.retryable ?? false,
    });
    if (!execution) continue;
    executedTools.push(call.tool);
    const result = parseOutput(execution.output);
    results.push(result);
    retryable = execution.retryable;
    if (!isSuccessfulResult(result)) break;
  }

  return results.length > 0
    ? { output: JSON.stringify({ executedTools, results }), retryable }
    : null;
}

export function assertRequiredToolCall(input: {
  generation: AssistantGeneration;
  allowedTools: AssistantToolKey[];
  completionIsGrounded?: boolean;
}): ToolExecution | null {
  if (
    input.allowedTools.length === 0 ||
    input.generation.toolCalls.length > 0 ||
    input.generation.state.missingData.length > 0 ||
    (input.generation.transition.action === "complete" && input.completionIsGrounded) ||
    input.generation.decision === "emergency" ||
    input.generation.decision === "out_of_scope"
  ) {
    return null;
  }
  return executionError("tool_call_required", "O fluxo está sem dados pendentes; use uma tool autorizada ou informe o dado realmente ausente.");
}

export function getGroundedToolReply(output?: string) {
  if (!output) return null;
  try {
    const envelope = JSON.parse(output) as { executedTools?: string[]; results?: unknown[] };
    const tools = envelope.executedTools ?? [];
    const results = envelope.results ?? [];
    for (let index = Math.min(tools.length, results.length) - 1; index >= 0; index -= 1) {
      const key = tools[index];
      if (!isAssistantToolKey(key)) continue;
      const reply = getToolDefinition(key).getGroundedReply?.(JSON.stringify(results[index]));
      if (reply) return reply;
    }
  } catch {
    return null;
  }
  return null;
}

export function hasSuccessfulToolResult(output: string | undefined, tool: AssistantToolKey) {
  if (!output) return false;
  try {
    const envelope = JSON.parse(output) as {
      executedTools?: string[];
      results?: Array<{ ok?: boolean }>;
    };
    return envelope.executedTools?.some((executedTool, index) => (
      executedTool === tool && envelope.results?.[index]?.ok === true
    )) ?? false;
  } catch {
    return false;
  }
}

export function getToolValidationRecoveryReply(flowKey: string) {
  if (flowKey === "initial_triage") {
    return "Para continuar, preciso confirmar: esta será sua primeira consulta com o Dr. Matheus ou você já é paciente de retorno?";
  }
  if (flowKey === "payment_confirmation") {
    return "Antes de gerar os dados do sinal, preciso da sua confirmação: deseja prosseguir com o pagamento do sinal via Pix?";
  }
  if (flowKey === "collect_profile") {
    return "Não consegui validar a informação enviada. Pode conferir e me enviar novamente?";
  }
  if (flowKey === "schedule_appointment") {
    return "Não consegui validar sua preferência. Você prefere a Bioimpedância e a consulta no mesmo dia, em sequência, ou em horários separados?";
  }
  return "Não consegui validar sua última resposta. Pode conferir e me enviar novamente?";
}

function executionError(code: string, message: string): ToolExecution {
  return { output: JSON.stringify({ executedTools: [], results: [errorResult("assistant", code, message)] }), retryable: true };
}

function errorResult(tool: string, code: string, message: string) {
  return { ok: false, type: "validation_error", tool, errors: [{ field: "toolCalls", code, message }] };
}

function parseOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return { ok: false, type: "operational_error", error: "A tool retornou um resultado inválido." };
  }
}

function isSuccessfulResult(result: unknown) {
  return Boolean(result && typeof result === "object" && (result as { ok?: unknown }).ok === true);
}

function resolvePreviousReferences(
  args: Record<string, unknown>,
  previous: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string" || !value.startsWith("$previous.")) {
      resolved[key] = value;
      continue;
    }
    const reference = readReference(previous, value.slice("$previous.".length));
    if (reference === undefined) {
      return { ok: false, error: `A referência ${value} não existe no resultado anterior ou não é inequívoca.` };
    }
    resolved[key] = reference;
  }
  return { ok: true, value: resolved };
}

function readReference(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    const match = /^(\w+)(?:\[(\d+)\])?$/.exec(segment);
    if (!match || !current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[match[1]];
    if (match[2] !== undefined) {
      if (!Array.isArray(current) || current.length !== 1 || Number(match[2]) !== 0) return undefined;
      current = current[0];
    }
  }
  return typeof current === "string" || typeof current === "number" || typeof current === "boolean"
    ? current
    : undefined;
}