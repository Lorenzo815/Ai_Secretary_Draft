import "server-only";

import { AzureOpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { getModelConfig } from "./model-config";

const DB_NAME = "ai_secretary";
const TRACE_COLLECTION = "ai_task_calls";
const TRACE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
let client: AzureOpenAI | undefined;
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
  model: string;
  requestId?: string;
  finishReason?: string | null;
  usage?: object | null;
  durationMs: number;
}

export async function generateStructuredOutput<T>(
  request: StructuredModelRequest<T>,
): Promise<StructuredModelResult<T>> {
  const config = getModelConfig();
  client ??= new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
    maxRetries: 0,
    timeout: config.requestTimeoutMs,
  });
  const startedAt = new Date();
  const traceId = await startTrace({
    taskKey: request.taskKey,
    customerId: request.customerId,
    model: config.deployment,
    messageCount: request.messages.length,
    context: request.trace,
    startedAt,
  });

  try {
    const response = await client.chat.completions.create({
      model: config.deployment,
      messages: request.messages,
      max_completion_tokens: request.maxCompletionTokens ?? 4_096,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error(`A tarefa ${request.taskKey} retornou uma resposta vazia.`);
    const value = request.parse(content);
    const durationMs = Date.now() - startedAt.getTime();
    await completeTrace(traceId, {
      durationMs,
      requestId: response._request_id ?? undefined,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
    });
    return {
      value,
      model: config.deployment,
      requestId: response._request_id ?? undefined,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
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
  model: string;
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
  result: { durationMs: number; requestId?: string; finishReason?: string | null; usage?: object | null },
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
      },
    },
  ).catch((traceError) => console.error("AI task trace failure could not be recorded", traceError));
}