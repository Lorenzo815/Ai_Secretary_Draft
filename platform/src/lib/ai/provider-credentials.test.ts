import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteOne, findOne, replaceOne } = vi.hoisted(() => ({
  deleteOne: vi.fn(),
  findOne: vi.fn(),
  replaceOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection: () => ({ deleteOne, findOne, replaceOne }) }),
  }),
}));

import {
  clearStoredVercelGatewayApiKey,
  getVercelGatewayCredential,
  saveVercelGatewayApiKey,
} from "./provider-credentials";

describe("Vercel gateway credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    findOne.mockResolvedValue(null);
  });

  it("stores the API key encrypted and reads it from the database", async () => {
    const apiKey = "vck_database-secret-key-123456789";
    await saveVercelGatewayApiKey(apiKey, "admin@example.com");
    const stored = replaceOne.mock.calls[0][1];
    expect(JSON.stringify(stored)).not.toContain(apiKey);
    findOne.mockResolvedValue(stored);
    await expect(getVercelGatewayCredential()).resolves.toEqual({ apiKey, source: "database", kind: "api_key" });
  });

  it("prefers the environment key over the stored credential", async () => {
    process.env.AI_GATEWAY_API_KEY = "vck_environment-secret-key-123456";
    await expect(getVercelGatewayCredential()).resolves.toEqual({
      apiKey: "vck_environment-secret-key-123456",
      source: "environment",
      kind: "api_key",
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it("removes only the stored fallback credential", async () => {
    await clearStoredVercelGatewayApiKey();
    expect(deleteOne).toHaveBeenCalledWith({ _id: "vercel" });
  });

  it("rejects a Vercel personal access token", async () => {
    await expect(saveVercelGatewayApiKey("personal-access-token-123456789", "admin@example.com"))
      .rejects.toThrow("formato vck_");
    expect(replaceOne).not.toHaveBeenCalled();
  });
});