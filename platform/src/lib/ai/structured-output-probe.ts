import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { withModelRateLimitRetry } from "./retry";

export type ProbedStructuredOutputMode = "json_schema" | "tool_call" | "unsupported";

const PROBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean", const: true } },
};

export async function probeStructuredOutputClient(
  client: OpenAI,
  model: string,
  inferenceProvider?: string,
): Promise<{ mode: ProbedStructuredOutputMode; durationMs: number }> {
  const startedAt = Date.now();
  const providerOptions = inferenceProvider
    ? { providerOptions: { gateway: { only: [inferenceProvider] } } }
    : {};

  try {
    const native = await withModelRateLimitRetry(() => client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Return the requested structured result." }],
      max_completion_tokens: 64,
      response_format: {
        type: "json_schema",
        json_schema: { name: "capability_probe", strict: true, schema: PROBE_SCHEMA },
      },
      ...providerOptions,
    }));
    if (isValidProbePayload(native.value.choices[0]?.message.content)) {
      return { mode: "json_schema", durationMs: Date.now() - startedAt };
    }
  } catch (error) {
    if (!isCapabilityRejection(error)) throw error;
  }

  try {
    const forced = await requestToolProbe(client, model, providerOptions, true);
    if (hasValidToolProbe(forced.value)) {
      return { mode: "tool_call", durationMs: Date.now() - startedAt };
    }
  } catch (error) {
    if (!isThinkingToolChoiceRejection(error)) {
      if (!isCapabilityRejection(error)) throw error;
      return { mode: "unsupported", durationMs: Date.now() - startedAt };
    }
    const automatic = await requestToolProbe(client, model, providerOptions, false);
    if (hasValidToolProbe(automatic.value)) {
      return { mode: "tool_call", durationMs: Date.now() - startedAt };
    }
  }

  return { mode: "unsupported", durationMs: Date.now() - startedAt };
}

function requestToolProbe(client: OpenAI, model: string, providerOptions: object, forceTool: boolean) {
  return withModelRateLimitRetry(() => client.chat.completions.create({
    model,
    messages: [{ role: "user", content: "Call capability_probe with ok set to true. Do not answer with text." }],
    max_completion_tokens: 64,
    tools: [{
      type: "function",
      function: {
        name: "capability_probe",
        description: "Returns the structured-output capability probe result.",
        strict: true,
        parameters: PROBE_SCHEMA,
      },
    }],
    ...(forceTool ? { tool_choice: { type: "function" as const, function: { name: "capability_probe" } } } : {}),
    parallel_tool_calls: false,
    ...providerOptions,
  }));
}

function hasValidToolProbe(response: ChatCompletion) {
  const toolCall = response.choices[0]?.message.tool_calls?.find((call) => (
    "function" in call && call.function.name === "capability_probe"
  ));
  return Boolean(toolCall && "function" in toolCall && isValidProbePayload(toolCall.function.arguments));
}

function isValidProbePayload(content: string | null | undefined) {
  if (!content) return false;
  try {
    const value = JSON.parse(content) as { ok?: unknown };
    return value.ok === true;
  } catch {
    return false;
  }
}

function isCapabilityRejection(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  return error.status === 400 || error.status === 422;
}

function isThinkingToolChoiceRejection(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error) || error.status !== 400) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /thinking mode.*tool_choice/i.test(message);
}