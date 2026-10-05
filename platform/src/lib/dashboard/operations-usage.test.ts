import { describe, expect, it } from "vitest";
import { collectAudioTranscriptionModelIds } from "./operations-usage";

describe("operations audio usage", () => {
  it("detects transcription models from duration usage without requiring task metadata", () => {
    const models = collectAudioTranscriptionModelIds([
      {
        model: "openai/whisper-1",
        normalizedUsage: { audioDurationSeconds: 96 },
      },
      {
        model: "openai/gpt-5.4-mini",
        normalizedUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      },
      {
        model: "OPENAI/GPT-4O-MINI-TRANSCRIBE",
        usage: { audioDurationSeconds: 12 },
      },
    ]);

    expect(models).toEqual(new Set([
      "openai/whisper-1",
      "openai/gpt-4o-mini-transcribe",
    ]));
  });
});
