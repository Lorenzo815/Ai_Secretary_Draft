import { describe, expect, it } from "vitest";
import { estimateModelCallCostUsd } from "./model-cost";

describe("estimateModelCallCostUsd", () => {
  it("prices new input, cached input, and output separately", () => {
    expect(estimateModelCallCostUsd({
      inputTokens: 1_000_000,
      cachedInputTokens: 600_000,
      outputTokens: 100_000,
    }, {
      inputPricePerMillion: 0.75,
      cachedInputPricePerMillion: 0.075,
      cacheWritePricePerMillion: 0,
      outputPricePerMillion: 4.5,
    })).toBeCloseTo(0.795);
  });

  it("includes cache writes when the provider charges for them", () => {
    expect(estimateModelCallCostUsd({
      inputTokens: 1_000,
      cacheWriteInputTokens: 400,
      outputTokens: 100,
    }, {
      inputPricePerMillion: 2,
      cachedInputPricePerMillion: 0.2,
      cacheWritePricePerMillion: 2.5,
      outputPricePerMillion: 10,
    })).toBeCloseTo(0.004);
  });

  it("does not invent estimates for unavailable pricing or incomplete usage", () => {
    expect(estimateModelCallCostUsd({
      inputTokens: 1_000,
      outputTokens: 100,
    }, undefined)).toBeUndefined();
    expect(estimateModelCallCostUsd({ inputTokens: 1_000 }, {
      inputPricePerMillion: 0.75,
      cachedInputPricePerMillion: 0.075,
      cacheWritePricePerMillion: 0,
      outputPricePerMillion: 4.5,
    })).toBeUndefined();
  });
});