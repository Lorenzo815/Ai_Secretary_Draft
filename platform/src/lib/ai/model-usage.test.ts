import { describe, expect, it } from "vitest";
import { normalizeModelUsage } from "./model-usage";

describe("normalizeModelUsage", () => {
  it("normalizes OpenAI Chat Completions usage", () => {
    expect(normalizeModelUsage({
      prompt_tokens: 6_242,
      completion_tokens: 224,
      total_tokens: 6_466,
      prompt_tokens_details: { cached_tokens: 2_816 },
      completion_tokens_details: { reasoning_tokens: 32 },
    })).toEqual({
      inputTokens: 6_242,
      outputTokens: 224,
      totalTokens: 6_466,
      cachedInputTokens: 2_816,
      reasoningTokens: 32,
    });
  });

  it("normalizes OpenAI Responses usage", () => {
    expect(normalizeModelUsage({
      input_tokens: 1_000,
      output_tokens: 200,
      total_tokens: 1_200,
      input_tokens_details: { cached_tokens: 700, cache_write_tokens: 100 },
      output_tokens_details: { reasoning_tokens: 80 },
    })).toMatchObject({ cachedInputTokens: 700, cacheWriteInputTokens: 100, reasoningTokens: 80 });
  });

  it("normalizes Vercel AI SDK usage and keeps unavailable fields optional", () => {
    expect(normalizeModelUsage({
      inputTokens: 900,
      outputTokens: 100,
      inputTokenDetails: { cacheReadTokens: 600 },
    })).toEqual({ inputTokens: 900, outputTokens: 100, totalTokens: 1_000, cachedInputTokens: 600 });
    expect(normalizeModelUsage(null)).toBeNull();
    expect(normalizeModelUsage({ providerOnlyMetric: 1 })).toBeNull();
  });
});