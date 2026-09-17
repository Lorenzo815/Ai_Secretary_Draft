import { afterEach, describe, expect, it, vi } from "vitest";
import { getModelRequestTimeoutMs } from "./model-config";

describe("getModelRequestTimeoutMs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows slow model requests for up to 180 seconds by default", () => {
    vi.stubEnv("AI_MODEL_REQUEST_TIMEOUT_MS", "");

    expect(getModelRequestTimeoutMs()).toBe(180_000);
  });

  it("honors an explicit positive timeout", () => {
    vi.stubEnv("AI_MODEL_REQUEST_TIMEOUT_MS", "240000");

    expect(getModelRequestTimeoutMs()).toBe(240_000);
  });
});