import "server-only";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_MAX_DELAY_MS = 30_000;

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

export async function withModelRateLimitRetry<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
  const maxAttempts = readBoundedInteger("AI_RATE_LIMIT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1, 6);
  const maxDelayMs = readBoundedInteger("AI_RATE_LIMIT_MAX_DELAY_MS", DEFAULT_MAX_DELAY_MS, 1_000, 120_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      if (!isRateLimitError(error) || attempt === maxAttempts) throw error;
      const retryAfter = retryAfterMs(readRetryAfter(error));
      const exponentialDelay = 2 ** (attempt - 1) * 1_000;
      const jitter = Math.floor(Math.random() * Math.min(250, exponentialDelay / 4));
      await delay(Math.min(retryAfter ?? exponentialDelay + jitter, maxDelayMs));
    }
  }

  throw new Error("As tentativas de acesso ao modelo foram esgotadas.");
}

export function retryAfterMs(header: string | null, now = Date.now()) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function isRateLimitError(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && Number(error.status) === 429);
}

function readRetryAfter(error: unknown) {
  if (!error || typeof error !== "object" || !("headers" in error)) return null;
  const headers = error.headers;
  if (headers && typeof headers === "object" && "get" in headers && typeof headers.get === "function") {
    const value = headers.get("retry-after");
    return typeof value === "string" ? value : null;
  }
  if (headers && typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const value = record["retry-after"] ?? record["Retry-After"];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}