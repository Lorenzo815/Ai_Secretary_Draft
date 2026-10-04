import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createIndex, fetchWhatsAppMediaFile, getAiProviderConfiguration, getVercelGatewayCredential, insertOne, updateOne } = vi.hoisted(() => ({
  createIndex: vi.fn(),
  fetchWhatsAppMediaFile: vi.fn(),
  getAiProviderConfiguration: vi.fn(),
  getVercelGatewayCredential: vi.fn(),
  insertOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("./client", () => ({ fetchWhatsAppMediaFile }));
vi.mock("../ai/provider-config", () => ({ getAiProviderConfiguration }));
vi.mock("../ai/provider-credentials", () => ({ getVercelGatewayCredential }));
vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection: () => ({ createIndex, insertOne, updateOne }) }),
  }),
}));

import { fetchAndTranscribeWhatsAppAudio, testVercelAudioTranscription } from "./audio";

describe("WhatsApp audio transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiProviderConfiguration.mockResolvedValue({
      audioTranscription: { vercelModel: "openai/gpt-4o-mini-transcribe" },
    });
    getVercelGatewayCredential.mockResolvedValue({
      apiKey: "vck_test",
      source: "database",
      kind: "api_key",
    });
    createIndex.mockResolvedValue("index");
    insertOne.mockResolvedValue({ acknowledged: true });
    updateOne.mockResolvedValue({ acknowledged: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: " Quero marcar uma consulta. ", durationInSeconds: 12.5 }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("transcribes an OGG voice message through Vercel AI Gateway", async () => {
    const bytes = Buffer.from("audio");
    fetchWhatsAppMediaFile.mockResolvedValue({ bytes, mimeType: "audio/ogg" });

    await expect(fetchAndTranscribeWhatsAppAudio("media-123"))
      .resolves.toBe("Quero marcar uma consulta.");

    expect(fetchWhatsAppMediaFile).toHaveBeenCalledWith("media-123", "audio");
    expect(fetch).toHaveBeenCalledWith(
      "https://ai-gateway.vercel.sh/v4/ai/transcription-model",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer vck_test",
          "ai-model-id": "openai/gpt-4o-mini-transcribe",
        }),
        body: JSON.stringify({
          audio: bytes.toString("base64"),
          mediaType: "audio/ogg",
        }),
      }),
    );
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      taskKey: "audio_transcription",
      provider: "vercel",
      model: "openai/gpt-4o-mini-transcribe",
      status: "started",
    }));
    expect(updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: expect.objectContaining({
        status: "completed",
        usage: { audioDurationSeconds: 12.5 },
        normalizedUsage: { audioDurationSeconds: 12.5 },
      }) },
    );
  });

  it("fails explicitly when the saved audio model is empty", async () => {
    getAiProviderConfiguration.mockResolvedValue({
      audioTranscription: { vercelModel: "" },
    });

    await expect(fetchAndTranscribeWhatsAppAudio("media-123"))
      .rejects.toThrow("A transcrição de áudio não está configurada.");
    expect(fetchWhatsAppMediaFile).not.toHaveBeenCalled();
  });

  it("sends a valid silent WAV to empirically test the selected model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "", durationInSeconds: 1 }),
    }));

    await expect(testVercelAudioTranscription("google/gemini-3.5-transcribe"))
      .resolves.toMatchObject({
        model: "google/gemini-3.5-transcribe",
        audioDurationSeconds: 1,
      });

    const [, request] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body)) as { audio: string; mediaType: string };
    const wav = Buffer.from(body.audio, "base64");
    expect(body.mediaType).toBe("audio/wav");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(request?.headers).toEqual(expect.objectContaining({
      "ai-model-id": "google/gemini-3.5-transcribe",
    }));
  });
});
