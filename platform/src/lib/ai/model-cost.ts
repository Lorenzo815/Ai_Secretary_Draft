import type { NormalizedModelUsage } from "./model-usage";

export interface ModelTokenPricing {
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  cachedInputPricePerMillion: number | null;
  cacheWritePricePerMillion: number | null;
}

export function estimateModelCallCostUsd(
  usage: NormalizedModelUsage | null | undefined,
  pricing: ModelTokenPricing | null | undefined,
) {
  if (usage?.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  if (pricing?.inputPricePerMillion === null || pricing?.inputPricePerMillion === undefined) return undefined;
  if (pricing.outputPricePerMillion === null) return undefined;

  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const newInputTokens = usage.inputTokens - cachedInputTokens;
  const cachedInputRate = pricing.cachedInputPricePerMillion ?? pricing.inputPricePerMillion;
  const cacheWriteTokens = usage.cacheWriteInputTokens ?? 0;
  const cacheWriteRate = pricing.cacheWritePricePerMillion ?? 0;

  return (
    newInputTokens * pricing.inputPricePerMillion
    + cachedInputTokens * cachedInputRate
    + cacheWriteTokens * cacheWriteRate
    + usage.outputTokens * pricing.outputPricePerMillion
  ) / 1_000_000;
}
