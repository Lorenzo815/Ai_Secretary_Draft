import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn(), update: vi.fn(), health: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/ai/azure-access", () => ({ verifyAzureAccessPassword: () => true }));
vi.mock("@/lib/ai/provider-config", () => ({
  getAiProviderConfiguration: vi.fn(), getAiProviderStatus: vi.fn(async () => ({})), updateAiProviderConfiguration: mocks.update,
}));
vi.mock("@/lib/ai/vercel-models", () => ({ listVercelLanguageModels: vi.fn(), listVercelModelEndpoints: vi.fn(), listVercelTranscriptionModels: vi.fn() }));
vi.mock("@/lib/ai/provider-credentials", () => ({ saveVercelGatewayApiKey: mocks.saveKey, clearStoredVercelGatewayApiKey: mocks.clearKey }));
vi.mock("@/lib/ai/providers/registry", () => ({ checkProviderHealth: mocks.health, probeProviderStructuredOutput: vi.fn() }));
vi.mock("@/lib/whatsapp/audio", () => ({ testVercelAudioTranscription: vi.fn() }));

import { PATCH, POST, PUT } from "./route";

const request = (body: unknown) => new Request("https://oria.test/api/settings/ai-models", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { email: "admin@clinica.test" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("AI settings are managed by Oria", () => {
  it("refuses any clinic changing the Oria-wide gateway key, the models or running paid tests", async () => {
    expect((await PATCH(request({ apiKey: "vck_" + "x".repeat(40) }))).status).toBe(403);
    expect((await PATCH(request({ clear: true }))).status).toBe(403);
    expect((await PUT(request({ expectedRevision: 1 }))).status).toBe(403);
    expect((await POST(request({ provider: "vercel", model: "openai/gpt-5.4-mini" }))).status).toBe(403);
    expect(mocks.saveKey).not.toHaveBeenCalled();
    expect(mocks.clearKey).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it("still requires a session first", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await PATCH(request({ clear: true }))).status).toBe(401);
  });
});
