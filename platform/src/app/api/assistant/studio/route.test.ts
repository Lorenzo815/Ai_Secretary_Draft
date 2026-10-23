import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentConfiguration } from "../../../../lib/assistant/agent/defaults";
import type { AgentConfigurationDocument } from "../../../../lib/assistant/agent/contracts";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getAgentConfiguration: vi.fn(),
  updateAgentConfiguration: vi.fn(),
  getCalendarSettings: vi.fn(),
  getPaymentProviderConfiguration: vi.fn(),
  getMercadoPagoCredentialStatus: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/assistant/agent", () => ({
  AGENT_STRUCTURAL_POLICY: "policy",
  buildAgentActionSchema: vi.fn(() => ({})),
  buildAgentDeveloperPrompt: vi.fn(() => "prompt"),
  getAgentConfiguration: mocks.getAgentConfiguration,
  updateAgentConfiguration: mocks.updateAgentConfiguration,
}));
vi.mock("@/lib/assistant/tools", () => ({ listToolMetadata: vi.fn(() => []) }));
vi.mock("@/lib/calendar", () => ({ getCalendarSettings: mocks.getCalendarSettings }));
vi.mock("@/lib/automation", () => ({
  listAutomationRules: vi.fn(async () => []),
  replaceAutomationRules: vi.fn(),
}));
vi.mock("@/lib/qualification/config", () => ({
  getLeadQualificationConfiguration: vi.fn(async () => ({})),
  updateLeadQualificationConfiguration: vi.fn(),
}));
vi.mock("@/lib/follow-up/config", () => ({
  getFollowUpConfiguration: vi.fn(async () => ({})),
  updateFollowUpConfiguration: vi.fn(),
}));
vi.mock("@/lib/payments", () => ({
  getPaymentProviderConfiguration: mocks.getPaymentProviderConfiguration,
  getMercadoPagoCredentialStatus: mocks.getMercadoPagoCredentialStatus,
}));

import { GET, PUT } from "./route";

describe("Studio read-only payment configuration", () => {
  let configuration: AgentConfigurationDocument;

  beforeEach(() => {
    vi.clearAllMocks();
    configuration = createDefaultAgentConfiguration();
    configuration.payment = { pixKey: "private-pix-test", recipientName: "Clinic", signalAmountCents: 25_000 };
    mocks.getServerSession.mockResolvedValue({ user: { email: "team@example.com" } });
    mocks.getAgentConfiguration.mockResolvedValue(configuration);
    mocks.getCalendarSettings.mockResolvedValue({
      eventTypes: configuration.bookableEventTypeKeys.map((key) => ({ key })),
    });
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "mercado_pago", humanFallbackEnabled: true });
    mocks.getMercadoPagoCredentialStatus.mockResolvedValue({ configured: true });
    mocks.updateAgentConfiguration.mockImplementation(async (input: { configuration: Partial<AgentConfigurationDocument> }) => ({
      ...configuration,
      ...input.configuration,
    }));
  });

  it.each([true, false])("reports Mercado Pago readiness independently of manual Pix (%s)", async (manualConfigured) => {
    configuration.payment.pixKey = manualConfigured ? "private-pix-test" : "";
    configuration.payment.recipientName = manualConfigured ? "Clinic" : "";

    const body = await (await GET()).json();

    expect(body.paymentStatus).toEqual({
      activeProvider: "mercado_pago",
      humanFallbackEnabled: true,
      manualConfigured,
      mercadoPagoConfigured: true,
    });
    expect(body.configuration.payment).toEqual({ signalAmountCents: 25_000 });
    expect(JSON.stringify(body)).not.toContain("private-pix-test");
  });

  it("reports missing Mercado Pago credentials even when manual Pix is configured", async () => {
    mocks.getMercadoPagoCredentialStatus.mockResolvedValue({ configured: false });

    const body = await (await GET()).json();

    expect(body.paymentStatus.manualConfigured).toBe(true);
    expect(body.paymentStatus.mercadoPagoConfigured).toBe(false);
  });

  it.each([undefined, { signalAmountCents: 999, pixKey: "stale-key", recipientName: "Stale recipient" }])(
    "preserves every payment setting when Studio saves with payment %j",
    async (payment) => {
      const response = await PUT(new Request("http://localhost/api/assistant/studio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "agent",
          expectedRevision: configuration.revision,
          configuration: { identityPrompt: "Updated identity", payment },
        }),
      }));

      expect(response.status).toBe(200);
      expect(mocks.updateAgentConfiguration).toHaveBeenCalledWith(expect.objectContaining({
        expectedRevision: configuration.revision,
        configuration: expect.objectContaining({
          identityPrompt: "Updated identity",
          payment: configuration.payment,
        }),
      }));
      expect((await response.json()).configuration.payment).toEqual({ signalAmountCents: 25_000 });
    },
  );

  it("still rejects stale Studio revisions", async () => {
    mocks.updateAgentConfiguration.mockRejectedValue(new Error("A configura\u00e7\u00e3o foi alterada por outra sess\u00e3o."));

    const response = await PUT(new Request("http://localhost/api/assistant/studio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "agent", expectedRevision: 0, configuration: { identityPrompt: "Updated" } }),
    }));

    expect(response.status).toBe(409);
  });

  it("requires authentication before returning payment status", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect(mocks.getMercadoPagoCredentialStatus).not.toHaveBeenCalled();
  });
});
