import "server-only";

import { ObjectId } from "mongodb";
import { getAiProviderConfiguration } from "../ai/provider-config";
import { getVercelGatewayCredential } from "../ai/provider-credentials";
import clientPromise from "../mongodb";
import { fetchWhatsAppMediaFile } from "./client";

const DB_NAME = "ai_secretary";
const TRACE_COLLECTION = "ai_task_calls";
const TRACE_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const TRANSCRIPTION_URL = "https://ai-gateway.vercel.sh/v4/ai/transcription-model";
const TRANSCRIPTION_TIMEOUT_MS = 90_000;
let indexesPromise: Promise<unknown> | undefined;

export async function fetchAndTranscribeWhatsAppAudio(mediaId: string, customerId?: ObjectId) {
  const configuration = await getAiProviderConfiguration();
  const model = configuration.audioTranscription.vercelModel;
  if (!model) {
    throw new Error("A transcrição de áudio não está configurada.");
  }
  const media = await fetchWhatsAppMediaFile(mediaId, "audio");
  const result = await transcribeAudioWithVercel(media.bytes, media.mimeType, model, {
    taskKey: "audio_transcription",
    customerId,
    requireText: true,
  });
  return result.text;
}

export async function testVercelAudioTranscription(model: string) {
  const startedAt = Date.now();
  const result = await transcribeAudioWithVercel(createSilentWav(), "audio/wav", model, {
    taskKey: "audio_transcription_test",
    requireText: false,
  });
  return {
    model,
    durationMs: Date.now() - startedAt,
    audioDurationSeconds: result.durationInSeconds ?? 1,
    checkedAt: new Date().toISOString(),
  };
}

async function transcribeAudioWithVercel(
  bytes: Buffer,
  mimeType: string,
  model: string,
  trace: { taskKey: "audio_transcription" | "audio_transcription_test"; customerId?: ObjectId; requireText: boolean },
) {
  const credential = await getVercelGatewayCredential();
  if (!credential) throw new Error("A credencial do Vercel AI Gateway não está configurada.");
  const startedAt = new Date();
  const traceId = await startAudioTrace({
    taskKey: trace.taskKey,
    customerId: trace.customerId,
    model,
    credentialSource: credential.source,
    startedAt,
  });
  try {
    const response = await fetch(TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1",
        "ai-transcription-model-specification-version": "4",
        "ai-model-id": model,
      },
      body: JSON.stringify({
        audio: bytes.toString("base64"),
        mediaType: mimeType,
      }),
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`O Vercel AI Gateway recusou a transcrição (HTTP ${response.status}).`),
        { status: response.status },
      );
    }
    const result = await response.json() as { text?: unknown; durationInSeconds?: unknown };
    const transcription = typeof result.text === "string" ? result.text.trim() : "";
    if (trace.requireText && !transcription) {
      throw new Error("A transcrição do áudio retornou vazia.");
    }
    const durationInSeconds = typeof result.durationInSeconds === "number" && Number.isFinite(result.durationInSeconds)
      ? result.durationInSeconds
      : null;
    await completeAudioTrace(traceId, Date.now() - startedAt.getTime(), durationInSeconds);
    return { text: transcription, durationInSeconds };
  } catch (error) {
    await failAudioTrace(traceId, Date.now() - startedAt.getTime(), error);
    throw error;
  }
}

async function startAudioTrace(input: {
  taskKey: "audio_transcription" | "audio_transcription_test";
  customerId?: ObjectId;
  model: string;
  credentialSource: string;
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
    await collection.insertOne({
      _id: traceId,
      ...input,
      provider: "vercel",
      selectedProvider: "vercel",
      inferenceProvider: null,
      status: "started",
    });
    return traceId;
  } catch (error) {
    console.error("Audio transcription trace could not be started", error);
    return null;
  }
}

async function completeAudioTrace(traceId: ObjectId | null, durationMs: number, audioDurationSeconds: number | null) {
  if (!traceId) return;
  const usage = audioDurationSeconds === null ? undefined : { audioDurationSeconds };
  await (await clientPromise).db(DB_NAME).collection(TRACE_COLLECTION).updateOne(
    { _id: traceId },
    {
      $set: {
        status: "completed",
        completedAt: new Date(),
        durationMs,
        ...(usage ? { usage, normalizedUsage: usage } : {}),
      },
    },
  ).catch((error) => console.error("Audio transcription trace could not be completed", error));
}

async function failAudioTrace(traceId: ObjectId | null, durationMs: number, error: unknown) {
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
  ).catch((traceError) => console.error("Audio transcription trace failure could not be recorded", traceError));
}

function createSilentWav() {
  const sampleRate = 16_000;
  const bytesPerSample = 2;
  const dataSize = sampleRate * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}
