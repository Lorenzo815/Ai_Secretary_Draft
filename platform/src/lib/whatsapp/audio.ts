import "server-only";

import { getAiProviderConfiguration } from "../ai/provider-config";
import { getVercelGatewayCredential } from "../ai/provider-credentials";
import { fetchWhatsAppMediaFile } from "./client";

const TRANSCRIPTION_URL = "https://ai-gateway.vercel.sh/v4/ai/transcription-model";
const TRANSCRIPTION_TIMEOUT_MS = 90_000;

export async function fetchAndTranscribeWhatsAppAudio(mediaId: string) {
  const configuration = await getAiProviderConfiguration();
  const model = configuration.audioTranscription.vercelModel;
  if (!model) {
    throw new Error("A transcrição de áudio não está configurada.");
  }
  const media = await fetchWhatsAppMediaFile(mediaId, "audio");
  const result = await transcribeAudioWithVercel(media.bytes, media.mimeType, model);
  if (!result.text) throw new Error("A transcrição do áudio retornou vazia.");
  return result.text;
}

export async function testVercelAudioTranscription(model: string) {
  const startedAt = Date.now();
  const result = await transcribeAudioWithVercel(createSilentWav(), "audio/wav", model);
  return {
    model,
    durationMs: Date.now() - startedAt,
    audioDurationSeconds: result.durationInSeconds ?? 1,
    checkedAt: new Date().toISOString(),
  };
}

async function transcribeAudioWithVercel(bytes: Buffer, mimeType: string, model: string) {
  const credential = await getVercelGatewayCredential();
  if (!credential) throw new Error("A credencial do Vercel AI Gateway não está configurada.");
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
  const durationInSeconds = typeof result.durationInSeconds === "number" && Number.isFinite(result.durationInSeconds)
    ? result.durationInSeconds
    : null;
  return { text: transcription, durationInSeconds };
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
