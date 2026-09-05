export interface NormalizedModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
}

export function normalizeModelUsage(usage: unknown): NormalizedModelUsage | null {
  const source = asRecord(usage);
  if (!source) return null;

  const inputDetails = asRecord(source.inputTokenDetails);
  const outputDetails = asRecord(source.outputTokenDetails);
  const promptDetails = asRecord(source.prompt_tokens_details);
  const completionDetails = asRecord(source.completion_tokens_details);
  const responseInputDetails = asRecord(source.input_tokens_details);
  const responseOutputDetails = asRecord(source.output_tokens_details);

  const inputTokens = firstNumber(source.inputTokens, source.prompt_tokens, source.input_tokens);
  const outputTokens = firstNumber(source.outputTokens, source.completion_tokens, source.output_tokens);
  const reportedTotal = firstNumber(source.totalTokens, source.total_tokens);
  const normalized = compactUsage({
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined),
    cachedInputTokens: firstNumber(
      inputDetails?.cacheReadTokens,
      promptDetails?.cached_tokens,
      responseInputDetails?.cached_tokens,
    ),
    cacheWriteInputTokens: firstNumber(
      inputDetails?.cacheWriteTokens,
      responseInputDetails?.cache_write_tokens,
    ),
    reasoningTokens: firstNumber(
      outputDetails?.reasoningTokens,
      completionDetails?.reasoning_tokens,
      responseOutputDetails?.reasoning_tokens,
    ),
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function compactUsage(usage: NormalizedModelUsage): NormalizedModelUsage {
  return Object.fromEntries(
    Object.entries(usage).filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}