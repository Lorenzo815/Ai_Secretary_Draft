import "server-only";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { normalizeModelUsage, type NormalizedModelUsage } from "./model-usage";
import { withModelRateLimitRetry } from "./retry";
import { getProviderClient } from "./providers/registry";
import type { AiProvider } from "./providers/types";
import { resolveAiModel } from "./routing";

type StructuredOutputMode = "json_schema" | "tool_call" | "tool_call_auto";

const DB_NAME = "ai_secretary";
const TRACE_COLLECTION = "ai_task_calls";
const TRACE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
let indexesPromise: Promise<unknown> | undefined;

export interface StructuredModelRequest<T> {
  taskKey: string;
  customerId?: ObjectId;
  messages: ChatCompletionMessageParam[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxCompletionTokens?: number;
  trace?: Record<string, unknown>;
  parse: (content: string) => T;
}

export interface StructuredModelResult<T> {
  value: T;
  provider: AiProvider;
  model: string;
  requestId?: string;
  finishReason?: string | null;
  usage?: object | null;
  normalizedUsage?: NormalizedModelUsage | null;
  attempts: number;
  durationMs: number;
}

export async function generateStructuredOutput<T>(
  request: StructuredModelRequest<T>,
): Promise<StructuredModelResult<T>> {
  const resolved = await resolveAiModel(request.taskKey);
  if (!resolved.credential) {
    throw new Error(`A credencial do provedor ${resolved.provider} não está configurada.`);
  }
  const client = getProviderClient(resolved.provider, resolved.model, resolved.credential);
  const startedAt = new Date();
  const traceId = await startTrace({
    taskKey: request.taskKey,
    customerId: request.customerId,
    provider: resolved.provider,
    selectedProvider: resolved.selectedProvider,
    credentialSource: resolved.credential.source,
    model: resolved.model,
    inferenceProvider: resolved.inferenceProvider,
    messageCount: request.messages.length,
    context: request.trace,
    startedAt,
  });

  try {
    const generated = await requestStructuredContent(client, {
      model: resolved.model,
      messages: request.messages,
      schemaName: request.schemaName,
      schema: request.schema,
      maxCompletionTokens: request.maxCompletionTokens ?? 4_096,
      inferenceProvider: resolved.provider === "vercel" ? resolved.inferenceProvider : null,
      parse: request.parse,
    });
    const { response, retried, outputMode, content, value } = generated;
    const choice = response.choices[0];
    if (!content) {
      throw new EmptyStructuredOutputError(`A tarefa ${request.taskKey} retornou uma resposta vazia.`, {
        requestId: response._request_id ?? undefined,
        finishReason: choice?.finish_reason,
        usage: response.usage,
        normalizedUsage: normalizeModelUsage(response.usage),
        attempts: retried.attempts,
        outputMode,
        hasToolCalls: Boolean(choice?.message.tool_calls?.length),
      });
    }
    const durationMs = Date.now() - startedAt.getTime();
    await completeTrace(traceId, {
      durationMs,
      requestId: response._request_id ?? undefined,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
      normalizedUsage: normalizeModelUsage(response.usage),
      attempts: retried.attempts,
    });
    return {
      value,
      provider: resolved.provider,
      model: resolved.model,
      requestId: response._request_id ?? undefined,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
      normalizedUsage: normalizeModelUsage(response.usage),
      attempts: retried.attempts,
      durationMs,
    };
  } catch (error) {
    await failTrace(traceId, Date.now() - startedAt.getTime(), error);
    throw error;
  }
}

async function startTrace(input: {
  taskKey: string;
  customerId?: ObjectId;
  provider: AiProvider;
  selectedProvider: AiProvider;
  credentialSource?: string;
  model: string;
  inferenceProvider?: string | null;
  messageCount: number;
  context?: Record<string, unknown>;
  startedAt: Date;
}) {
  try {
    const collection = (await clientPromise).db(DB_NAME).collection(TRACE_COLLECTION);
    indexesPromise ??= Promise.all([
      collection.createIndex({ startedAt: 1 }, { expireAfterSeconds: TRACE_RETENTION_SECONDS }),
      collection.createIndex({ taskKey: 1, customerId: 1, startedAt: -1 }),
    ]);
    await indexesPromise;
    const traceId = new ObjectId();
    await collection.insertOne({ _id: traceId, ...input, status: "started" });
    return traceId;
  } catch (error) {
    console.error("AI task trace could not be started", error);
    return null;
  }
}

async function completeTrace(
  traceId: ObjectId | null,
  result: { durationMs: number; requestId?: string; finishReason?: string | null; usage?: object | null; normalizedUsage?: NormalizedModelUsage | null; attempts?: number },
) {
  if (!traceId) return;
  await (await clientPromise).db(DB_NAME).collection(TRACE_COLLECTION).updateOne(
    { _id: traceId },
    { $set: { ...result, status: "completed", completedAt: new Date() } },
  ).catch((error) => console.error("AI task trace could not be completed", error));
}

async function failTrace(traceId: ObjectId | null, durationMs: number, error: unknown) {
  if (!traceId) return;
  await (await clientPromise).db(DB_NAME).collection(TRACE_COLLECTION).updateOne(
    { _id: traceId },
    {
      $set: {
        status: "failed",
        completedAt: new Date(),
        durationMs,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
        ...(error instanceof EmptyStructuredOutputError ? error.diagnostic : {}),
      },
    },
  ).catch((traceError) => console.error("AI task trace failure could not be recorded", traceError));
}

class EmptyStructuredOutputError extends Error {
  name = "EmptyStructuredOutputError";

  constructor(
    message: string,
    readonly diagnostic: {
      requestId?: string;
      finishReason?: string | null;
      usage?: object | null;
      normalizedUsage?: NormalizedModelUsage | null;
      attempts: number;
      outputMode: StructuredOutputMode;
      hasToolCalls: boolean;
    },
  ) {
    super(message);
  }
}

async function requestStructuredContent<T>(
  client: ReturnType<typeof getProviderClient>,
  input: {
    model: string;
    messages: ChatCompletionMessageParam[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxCompletionTokens: number;
    inferenceProvider: string | null;
    parse: (content: string) => T;
  },
) {
  const providerOptions = input.inferenceProvider
    ? { providerOptions: { gateway: { only: [input.inferenceProvider] } } }
    : {};
  try {
    const retried = await withModelRateLimitRetry(() => client.chat.completions.create({
      model: input.model,
      messages: input.messages,
      max_completion_tokens: input.maxCompletionTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: input.schema },
      },
      ...providerOptions,
    }));
    const content = retried.value.choices[0]?.message.content;
    if (content) return { response: retried.value, retried, outputMode: "json_schema" as const, content, value: input.parse(content) };
  } catch (error) {
    if (!isStructuredTransportFailure(error)) throw error;
  }

  const tool = {
    type: "function" as const,
    function: {
      name: input.schemaName,
      description: "Retorna o resultado estruturado desta tarefa.",
      strict: true,
      parameters: input.schema,
    },
  };
  try {
    return await requestToolContent(client, input, tool, providerOptions, true);
  } catch (error) {
    if (!isThinkingToolChoiceRejection(error)) throw error;
    return requestToolContent(client, input, tool, providerOptions, false);
  }
}

async function requestToolContent<T>(
  client: ReturnType<typeof getProviderClient>,
  input: {
    model: string;
    messages: ChatCompletionMessageParam[];
    schemaName: string;
    maxCompletionTokens: number;
    parse: (content: string) => T;
  },
  tool: { type: "function"; function: { name: string; description: string; strict: boolean; parameters: Record<string, unknown> } },
  providerOptions: object,
  forceTool: boolean,
) {
  const retried = await withModelRateLimitRetry(() => client.chat.completions.create({
    model: input.model,
    messages: forceTool ? input.messages : [
      ...input.messages,
      { role: "system", content: `Responda chamando exclusivamente a função ${input.schemaName}.` },
    ],
    max_completion_tokens: input.maxCompletionTokens,
    tools: [tool],
    ...(forceTool ? { tool_choice: { type: "function" as const, function: { name: input.schemaName } } } : {}),
    parallel_tool_calls: false,
    ...providerOptions,
  }));
  const response = retried.value;
  const toolCall = response.choices[0]?.message.tool_calls?.find((call) => (
    "function" in call && call.function.name === input.schemaName
  ));
  const content = toolCall && "function" in toolCall ? toolCall.function.arguments : undefined;
  return {
    response,
    retried,
    outputMode: forceTool ? "tool_call" as const : "tool_call_auto" as const,
    content,
    value: content ? input.parse(content) : undefined as T,
  };
}

function isStructuredTransportFailure(error: unknown) {
  if (error instanceof SyntaxError || error instanceof EmptyStructuredOutputError) return true;
  return Boolean(error && typeof error === "object" && "status" in error && (error.status === 400 || error.status === 422));
}

function isThinkingToolChoiceRejection(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error) || error.status !== 400) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /thinking mode.*tool_choice/i.test(message);
}