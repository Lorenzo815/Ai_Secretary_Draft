import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryAfterMs, withModelRateLimitRetry } from "./retry";

describe("model rate limit retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    delete process.env.AI_RATE_LIMIT_MAX_ATTEMPTS;
    delete process.env.AI_RATE_LIMIT_MAX_DELAY_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns immediately when the first attempt succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    await expect(withModelRateLimitRetry(operation)).resolves.toEqual({ value: "ok", attempts: 1 });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("honors Retry-After seconds before retrying a 429", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({ status: 429, headers: new Headers({ "retry-after": "2" }) })
      .mockResolvedValue("ok");

    const result = withModelRateLimitRetry(operation);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(operation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ value: "ok", attempts: 2 });
  });

  it("uses bounded exponential backoff when Retry-After is absent", async () => {
    process.env.AI_RATE_LIMIT_MAX_ATTEMPTS = "3";
    const operation = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue("ok");

    const result = withModelRateLimitRetry(operation);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual({ value: "ok", attempts: 3 });
  });

  it("does not retry non-rate-limit errors", async () => {
    const error = { status: 402 };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withModelRateLimitRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("parses Retry-After dates and rejects malformed values", () => {
    const now = Date.parse("2026-09-17T12:00:00Z");
    expect(retryAfterMs("Thu, 17 Sep 2026 12:00:05 GMT", now)).toBe(5_000);
    expect(retryAfterMs("invalid", now)).toBeNull();
  });
});