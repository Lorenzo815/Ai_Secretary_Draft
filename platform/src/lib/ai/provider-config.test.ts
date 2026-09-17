import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOne, getVercelGatewayCredential, replaceOne, updateOne } = vi.hoisted(() => ({
  findOne: vi.fn(),
  getVercelGatewayCredential: vi.fn(),
  replaceOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection: () => ({ findOne, updateOne, replaceOne }) }),
  }),
}));

vi.mock("./provider-credentials", () => ({
  getVercelGatewayCredential,
  getVercelGatewayCredentialStatus: vi.fn(),
}));

import { updateAiProviderConfiguration } from "./provider-config";
import { resolveAiModel } from "./routing";

const stored = {
  _id: "active",
  revision: 2,
  preferredProvider: "vercel",
  tasks: {
    customer_agent: { vercelModel: "anthropic/claude-sonnet-4.6", azureModel: "gpt-5.4-mini" },
    lead_qualification: { vercelModel: "openai/gpt-5.4", azureModel: "gpt-5.4" },
  },
  updatedAt: new Date(),
  updatedBy: "admin@example.com",
};

describe("AI provider configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_GATEWAY_API_KEY;
    getVercelGatewayCredential.mockResolvedValue(null);
    findOne.mockResolvedValue(stored);
    replaceOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("uses the task-specific Vercel model when the gateway is configured", async () => {
    getVercelGatewayCredential.mockResolvedValue({ apiKey: "configured", source: "database" });
    await expect(resolveAiModel("customer_agent")).resolves.toEqual({
      provider: "vercel",
      model: "anthropic/claude-sonnet-4.6",
      inferenceProvider: null,
      selectedProvider: "vercel",
      credential: { secret: "configured", source: "database" },
    });
    await expect(resolveAiModel("lead_qualification")).resolves.toMatchObject({ model: "openai/gpt-5.4" });
  });

  it("keeps Vercel selected without falling back when its credential is missing", async () => {
    await expect(resolveAiModel("customer_agent")).resolves.toEqual({
      provider: "vercel",
      model: "anthropic/claude-sonnet-4.6",
      inferenceProvider: null,
      selectedProvider: "vercel",
      credential: null,
    });
  });

  it("rejects Azure deployments outside the allowlist", async () => {
    await expect(updateAiProviderConfiguration({
      expectedRevision: 2,
      activeProvider: "azure",
      azureAccessAuthorized: true,
      tasks: {
        customer_agent: { vercelModel: "openai/gpt-5.4", azureModel: "gpt-4o" },
        lead_qualification: { vercelModel: "openai/gpt-5.4-mini", azureModel: "gpt-5.4-mini" },
      },
      updatedBy: "admin@example.com",
    })).rejects.toThrow("deve ser gpt-5.4 ou gpt-5.4-mini");
    expect(replaceOne).not.toHaveBeenCalled();
  });

  it("rejects Azure selection without server authorization", async () => {
    await expect(updateAiProviderConfiguration({
      expectedRevision: 2,
      activeProvider: "azure",
      tasks: stored.tasks,
      updatedBy: "admin@example.com",
    })).rejects.toThrow("exige autorização protegida");
    expect(replaceOne).not.toHaveBeenCalled();
  });
});