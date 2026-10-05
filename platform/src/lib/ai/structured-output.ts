import "server-only";

import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { normalizeModelUsage, type NormalizedModelUsage } from "./model-usage";
import { withModelRateLimitRetry } from "./retry";
import { getProviderClient } from "./providers/registry";
import type { AiProvider } from "./providers/types";
import type { ReasoningEffort } from "./provider-config";
import { resolveAiModel } from "./routing";

type StructuredOutputMode = "json_schema" | "tool_call" | "tool_call_auto";

interface ProviderCallTrace {
  sequence: number;
  outputMode: StructuredOutputMode;
  requestId?: string;
  finishReason?: string | null;
  usage?: object | null;
  normalizedUsage?: NormalizedModelUsage | null;
  transportAttempts: number;
  durationMs: number;
  completedAt: Date;
}

interface AiTaskCallDocument {
  _id: ObjectId;
  taskKey: string;
  customerId?: ObjectId;
  provider: AiProvider;
  selectedProvider: AiProvider;
  credentialSource?: string;
  model: string;
  inferenceProvider?: string | null;
  messageCount: number;
  context?: Record<string, unknown>;
  status: "started" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  requestId?: string;
  finishReason?: string | null;
  usage?: object | null;
  normalizedUsage?: NormalizedModelUsage | null;
  attempts?: number;
  validationAttempts?: number;
  providerCallCount?: number;
  providerCallsWithUsage?: number;
  providerCalls?: ProviderCallTrace[];
  errorName?: string;
  errorMessage?: string;
  outputMode?: StructuredOutputMode;
  hasToolCalls?: boolean;
}

const DB_NAME = "ai_secretary";
const TRACE_COLLECTION = "ai_task_calls";
const TRACE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const MAX_STRUCTURED_OUTPUT_ATTEMPTS = 2;
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
  const providerCalls: ProviderCallTrace[] = [];
  const maxCompletionTokens = resolved.maxCompletionTokens;
  const initialCompletionTokens = request.maxCompletionTokens
    ? Math.min(request.maxCompletionTokens, maxCompletionTokens)
    : Math.max(512, Math.ceil(maxCompletionTokens / 2));
  const traceId = await startTrace({
    taskKey: request.taskKey,
    customerId: request.customerId,
    provider: resolved.provider,
    selectedProvider: resolved.selectedProvider,
    credentialSource: resolved.credential.source,
    model: resolved.model,
    inferenceProvider: resolved.inferenceProvider,
    messageCount: request.messages.length,
    context: {
      ...request.trace,
      generation: {
        reasoningEffort: resolved.reasoningEffort,
        initialCompletionTokens,
        maxCompletionTokens,
      },
    },
    startedAt,
  });

  try {
    const generated = await requestValidatedStructuredContent(client, {
      model: resolved.model,
      messages: request.messages,
      schemaName: request.schemaName,
      schema: request.schema,
      maxCompletionTokens: initialCompletionTokens,
      maxAdaptiveCompletionTokens: maxCompletionTokens,
      provider: resolved.provider,
      reasoningEffort: resolved.reasoningEffort,
      inferenceProvider: resolved.provider === "vercel" ? resolved.inferenceProvider : null,
      parse: request.parse,
      onProviderResponse: async (call) => {
        const tracedCall = { ...call, sequence: providerCalls.length + 1 };
        providerCalls.push(tracedCall);
        await appendProviderCall(traceId, tracedCall);
      },
    });
    const { response, outputMode, content, value, validationAttempts } = generated;
    const normalizedUsage = sumModelUsage(providerCalls.map((call) => call.normalizedUsage));
    const transportAttempts = providerCalls.reduce((sum, call) => sum + call.transportAttempts, 0);
    const choice = response.choices[0];
    if (!content) {
      throw new EmptyStructuredOutputError(`A tarefa ${request.taskKey} retornou uma resposta vazia.`, {
        requestId: response._request_id ?? undefined,
        finishReason: choice?.finish_reason,
        usage: response.usage,
        normalizedUsage,
        attempts: transportAttempts,
        validationAttempts,
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
      normalizedUsage,
      attempts: transportAttempts,
      validationAttempts,
      providerCallCount: providerCalls.length,
      providerCallsWithUsage: providerCalls.filter((call) => call.normalizedUsage).length,
    });
    return {
      value,
      provider: resolved.provider,
      model: resolved.model,
      requestId: response._request_id ?? undefined,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
      normalizedUsage,
      attempts: transportAttempts,
      durationMs,
    };
  } catch (error) {
    await failTrace(traceId, Date.now() - startedAt.getTime(), error, providerCalls);
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
    const collection = (await clientPromise).db(DB_NAME).collection<AiTaskCallDocument>(TRACE_COLLECTION);
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
  result: {
    durationMs: number;
    requestId?: string;
    finishReason?: string | null;
    usage?: object | null;
    normalizedUsage?: NormalizedModelUsage | null;
    attempts?: number;
    validationAttempts?: number;
    providerCallCount?: number;
    providerCallsWithUsage?: number;
  },
) {
  if (!traceId) return;
  await (await clientPromise).db(DB_NAME).collection<AiTaskCallDocument>(TRACE_COLLECTION).updateOne(
    { _id: traceId },
    { $set: { ...result, status: "completed", completedAt: new Date() } },
  ).catch((error) => console.error("AI task trace could not be completed", error));
}

async function appendProviderCall(traceId: ObjectId | null, call: ProviderCallTrace) {
  if (!traceId) return;
  await (await clientPromise).db(DB_NAME).collection<AiTaskCallDocument>(TRACE_COLLECTION).updateOne(
    { _id: traceId },
    { $push: { providerCalls: call } },
  ).catch((error) => console.error("AI provider call could not be traced", error));
}

async function failTrace(
  traceId: ObjectId | null,
  durationMs: number,
  error: unknown,
  providerCalls: ProviderCallTrace[],
) {
  if (!traceId) return;
  const normalizedUsage = sumModelUsage(providerCalls.map((call) => call.normalizedUsage));
  await (await clientPromise).db(DB_NAME).collection<AiTaskCallDocument>(TRACE_COLLECTION).updateOne(
    { _id: traceId },
    {
      $set: {
        status: "failed",
        completedAt: new Date(),
        durationMs,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
        ...(error instanceof EmptyStructuredOutputError ? error.diagnostic : {}),
        normalizedUsage,
        attempts: providerCalls.reduce((sum, call) => sum + call.transportAttempts, 0),
        providerCallCount: providerCalls.length,
        providerCallsWithUsage: providerCalls.filter((call) => call.normalizedUsage).length,
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
      validationAttempts: number;
      outputMode: StructuredOutputMode;
      hasToolCalls: boolean;
    },
  ) {
    super(message);
  }
}

async function requestValidatedStructuredContent<T>(
  client: ReturnType<typeof getProviderClient>,
  input: {
    model: string;
    messages: ChatCompletionMessageParam[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxCompletionTokens: number;
    maxAdaptiveCompletionTokens: number;
    provider: AiProvider;
    reasoningEffort: ReasoningEffort;
    inferenceProvider: string | null;
    parse: (content: string) => T;
    onProviderResponse: (call: Omit<ProviderCallTrace, "sequence">) => Promise<void>;
  },
) {
  let messages = input.messages;
  let maxCompletionTokens = input.maxCompletionTokens;
  for (let attempt = 1; attempt <= MAX_STRUCTURED_OUTPUT_ATTEMPTS; attempt += 1) {
    try {
      const generated = await requestStructuredContent(client, {
        ...input,
        messages,
        maxCompletionTokens,
        parse: (content) => parseStructuredContent(content, input.parse),
      });
      if (generated.content || attempt === MAX_STRUCTURED_OUTPUT_ATTEMPTS) {
        return { ...generated, validationAttempts: attempt };
      }
    } catch (error) {
      if (error instanceof StructuredOutputTokenLimitError) {
        if (attempt === MAX_STRUCTURED_OUTPUT_ATTEMPTS) throw error;
        maxCompletionTokens = Math.min(maxCompletionTokens * 2, input.maxAdaptiveCompletionTokens);
      } else if (!isStructuredOutputValidationFailure(error) || attempt === MAX_STRUCTURED_OUTPUT_ATTEMPTS) {
        throw unwrapStructuredOutputValidationError(error);
      }
    }
    messages = [
      ...input.messages,
      {
        role: "system",
        content: `A resposta estruturada anterior foi vazia ou inválida. Gere novamente e siga estritamente o schema ${input.schemaName}, sem texto fora do objeto estruturado.`,
      },
    ];
  }
  throw new Error("Não foi possível gerar uma resposta estruturada válida.");
}

class StructuredOutputValidationError extends Error {
  name = "StructuredOutputValidationError";

  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : "A resposta estruturada é inválida.");
  }
}

class StructuredOutputTokenLimitError extends Error {
  name = "StructuredOutputTokenLimitError";

  constructor(maxCompletionTokens: number) {
    super(`O modelo atingiu o limite de ${maxCompletionTokens} tokens antes de produzir a resposta estruturada.`);
  }
}

function parseStructuredContent<T>(content: string, parse: (content: string) => T) {
  try {
    return parse(content);
  } catch (error) {
    throw new StructuredOutputValidationError(error);
  }
}

function isStructuredOutputValidationFailure(error: unknown) {
  return error instanceof StructuredOutputValidationError;
}

function unwrapStructuredOutputValidationError(error: unknown) {
  return error instanceof StructuredOutputValidationError ? error.originalError : error;
}

async function requestStructuredContent<T>(
  client: ReturnType<typeof getProviderClient>,
  input: {
    model: string;
    messages: ChatCompletionMessageParam[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxCompletionTokens: number;
    provider: AiProvider;
    reasoningEffort: ReasoningEffort;
    inferenceProvider: string | null;
    parse: (content: string) => T;
    onProviderResponse: (call: Omit<ProviderCallTrace, "sequence">) => Promise<void>;
  },
) {
  const providerOptions = input.inferenceProvider
    ? { providerOptions: { gateway: { only: [input.inferenceProvider] } } }
    : {};
  try {
    const callStartedAt = Date.now();
    const retried = await withModelRateLimitRetry(() => client.chat.completions.create({
      model: input.model,
      messages: input.messages,
      max_completion_tokens: input.maxCompletionTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: input.schema },
      },
      ...reasoningOptions(input.provider, input.reasoningEffort),
      ...providerOptions,
    }));
    await input.onProviderResponse(toProviderCallTrace(
      retried.value,
      "json_schema",
      retried.attempts,
      Date.now() - callStartedAt,
    ));
    const choice = retried.value.choices[0];
    const content = choice?.message.content;
    if (content) return { response: retried.value, retried, outputMode: "json_schema" as const, content, value: input.parse(content) };
    if (choice?.finish_reason === "length") {
      throw new StructuredOutputTokenLimitError(input.maxCompletionTokens);
    }
  } catch (error) {
    if (error instanceof StructuredOutputTokenLimitError) throw error;
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
    provider: AiProvider;
    reasoningEffort: ReasoningEffort;
    parse: (content: string) => T;
    onProviderResponse: (call: Omit<ProviderCallTrace, "sequence">) => Promise<void>;
  },
  tool: { type: "function"; function: { name: string; description: string; strict: boolean; parameters: Record<string, unknown> } },
  providerOptions: object,
  forceTool: boolean,
) {
  const callStartedAt = Date.now();
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
    ...reasoningOptions(input.provider, input.reasoningEffort),
    ...providerOptions,
  }));
  const response = retried.value;
  const outputMode = forceTool ? "tool_call" as const : "tool_call_auto" as const;
  await input.onProviderResponse(toProviderCallTrace(
    response,
    outputMode,
    retried.attempts,
    Date.now() - callStartedAt,
  ));
  const toolCall = response.choices[0]?.message.tool_calls?.find((call) => (
    "function" in call && call.function.name === input.schemaName
  ));
  const content = toolCall && "function" in toolCall ? toolCall.function.arguments : undefined;
  if (!content && response.choices[0]?.finish_reason === "length") {
    throw new StructuredOutputTokenLimitError(input.maxCompletionTokens);
  }

  return {
    response,
    retried,
    outputMode,
    content,
    value: content ? input.parse(content) : undefined as T,
  };
}

function reasoningOptions(provider: AiProvider, effort: ReasoningEffort) {
  if (effort === "default") return {};
  return provider === "vercel"
    ? { reasoning: { effort } }
    : { reasoning_effort: effort };
}

function toProviderCallTrace(
  response: ChatCompletion & { _request_id?: string | null },
  outputMode: StructuredOutputMode,
  transportAttempts: number,
  durationMs: number,
): Omit<ProviderCallTrace, "sequence"> {
  return {
    outputMode,
    requestId: response._request_id ?? undefined,
    finishReason: response.choices[0]?.finish_reason,
    usage: response.usage,
    normalizedUsage: normalizeModelUsage(response.usage),
    transportAttempts,
    durationMs,
    completedAt: new Date(),
  };
}

function sumModelUsage(usages: Array<NormalizedModelUsage | null | undefined>) {
  const known = usages.filter((usage): usage is NormalizedModelUsage => Boolean(usage));
  if (known.length === 0) return null;
  const fields: Array<keyof NormalizedModelUsage> = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "reasoningTokens",
    "audioDurationSeconds",
  ];
  return Object.fromEntries(fields.flatMap((field) => {
    const values = known.map((usage) => usage[field]).filter((value): value is number => value !== undefined);
    return values.length > 0 ? [[field, values.reduce((sum, value) => sum + value, 0)]] : [];
  })) as NormalizedModelUsage;
}

function isStructuredTransportFailure(error: unknown) {
  if (
    error instanceof SyntaxError ||
    error instanceof EmptyStructuredOutputError ||
    error instanceof StructuredOutputValidationError
  ) return true;
  return Boolean(error && typeof error === "object" && "status" in error && (error.status === 400 || error.status === 422));
}

function isThinkingToolChoiceRejection(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error) || error.status !== 400) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /thinking mode.*tool_choice/i.test(message);
}