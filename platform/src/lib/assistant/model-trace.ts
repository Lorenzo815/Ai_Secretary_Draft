import "server-only";

import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import type { AssistantGeneration } from "./prompt";

const DB_NAME = "ai_secretary";
const COLLECTION_NAME = "assistant_model_calls";
const TRACE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
let indexesPromise: Promise<unknown> | undefined;

export async function startAssistantModelTrace(input: {
  customerId: ObjectId;
  flowKey: string;
  flowVersion: number;
  phase: string;
  messageCount: number;
}) {
  try {
    const collection = (await clientPromise).db(DB_NAME).collection(COLLECTION_NAME);
    indexesPromise ??= Promise.all([
      collection.createIndex({ startedAt: 1 }, { expireAfterSeconds: TRACE_RETENTION_SECONDS }),
      collection.createIndex({ customerId: 1, startedAt: -1 }),
    ]);
    await indexesPromise;
    const traceId = new ObjectId();
    await collection.insertOne({
      _id: traceId,
      ...input,
      status: "started",
      startedAt: new Date(),
    });
    return traceId;
  } catch (error) {
    console.error("Assistant model trace could not be started", error);
    return null;
  }
}

export async function completeAssistantModelTrace(input: {
  traceId: ObjectId | null;
  durationMs: number;
  requestId?: string | null;
  finishReason?: string | null;
  usage?: object | null;
  generation: AssistantGeneration;
}) {
  if (!input.traceId) return;
  await (await clientPromise).db(DB_NAME).collection(COLLECTION_NAME).updateOne(
    { _id: input.traceId },
    {
      $set: {
        status: "completed",
        completedAt: new Date(),
        durationMs: input.durationMs,
        requestId: input.requestId,
        finishReason: input.finishReason,
        usage: input.usage,
        result: {
          decision: input.generation.decision,
          reply: input.generation.reply,
          stage: input.generation.state.stage,
          collectedDataKeys: input.generation.state.collectedData.map((item) => item.key),
          missingData: input.generation.state.missingData,
          transition: input.generation.transition,
          toolCalls: input.generation.toolCalls.map((call) => ({
            tool: call.tool,
            argumentKeys: Object.keys(call.arguments),
          })),
        },
      },
    },
  );
}

export async function failAssistantModelTrace(input: {
  traceId: ObjectId | null;
  durationMs: number;
  error: unknown;
}) {
  if (!input.traceId) return;
  await (await clientPromise).db(DB_NAME).collection(COLLECTION_NAME).updateOne(
    { _id: input.traceId },
    {
      $set: {
        status: "failed",
        completedAt: new Date(),
        durationMs: input.durationMs,
        errorName: input.error instanceof Error ? input.error.name : "UnknownError",
        errorMessage: input.error instanceof Error ? input.error.message.slice(0, 1_000) : String(input.error).slice(0, 1_000),
      },
    },
  );
}