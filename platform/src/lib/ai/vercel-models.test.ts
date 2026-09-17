import { afterEach, describe, expect, it, vi } from "vitest";
import { listVercelLanguageModels, listVercelModelEndpoints } from "./vercel-models";

describe("Vercel model catalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps language models and converts per-token pricing to per-million pricing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        {
          id: "openai/gpt-5.4-mini",
          name: "GPT 5.4 Mini",
          owned_by: "openai",
          description: "Efficient model",
          type: "language",
          context_window: 400_000,
          max_tokens: 128_000,
          tags: ["reasoning", "tool-use", "structured-output"],
          modalities: { input: ["text", "image"], output: ["text"] },
          pricing: { input: "0.00000075", output: "0.0000045" },
        },
        { id: "openai/gpt-image-2", type: "image", pricing: {} },
      ] }),
    }));

    await expect(listVercelLanguageModels()).resolves.toEqual([expect.objectContaining({
      id: "openai/gpt-5.4-mini",
      inputPricePerMillion: 0.75,
      outputPricePerMillion: 4.5,
      supportsTools: true,
      supportsImages: true,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      suitabilityIndex: 95,
    })]);
  });

  it("lists inference providers with their own prices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { endpoints: [
        {
          provider_name: "premium-provider",
          pricing: { prompt: "0.000002", completion: "0.000010" },
          uptime_last_1h: 99.9,
          supported_parameters: ["response_format"],
          has_zdr: true,
        },
        {
          provider_name: "low-cost-provider",
          pricing: { prompt: "0.000001", completion: "0.000004" },
          uptime_last_1h: 99.5,
          supported_parameters: [],
        },
      ] } }),
    }));

    await expect(listVercelModelEndpoints("openai/gpt-test")).resolves.toEqual([
      expect.objectContaining({
        provider: "low-cost-provider",
        inputPricePerMillion: 1,
        outputPricePerMillion: 4,
      }),
      expect.objectContaining({
        provider: "premium-provider",
        inputPricePerMillion: 2,
        outputPricePerMillion: 10,
        supportsStructuredOutput: true,
        zeroDataRetention: true,
      }),
    ]);
  });
});