import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  updateAgentPaymentSettings: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/admin/database", () => ({ clearDynamicData: vi.fn(), clearDynamicDataForCustomer: vi.fn() }));
vi.mock("@/lib/assistant/agent", () => ({
  getAgentConfiguration: vi.fn(),
  setAgentEnabled: vi.fn(),
  updateAgentPaymentSettings: mocks.updateAgentPaymentSettings,
}));
vi.mock("@/lib/payments", () => ({
  clearStoredMercadoPagoCredential: vi.fn(),
  getMercadoPagoCredentialStatus: vi.fn(),
  saveMercadoPagoCredential: vi.fn(),
  updatePaymentProviderConfiguration: vi.fn(),
}));
vi.mock("@/lib/payments/providers/mercado-pago", () => ({ checkMercadoPagoAccount: vi.fn() }));

import { PUT } from "./route";

function request(payment: unknown) {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment }),
  });
}

describe("payment settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "team@example.com" } });
    mocks.updateAgentPaymentSettings.mockResolvedValue({
      payment: { pixKey: "private-pix-test", recipientName: "Clinic", signalAmountCents: 25_000 },
    });
  });

  it("saves only the amount and returns the saved summary without exposing the key", async () => {
    const response = await PUT(request({ signalAmountCents: 25_000 }));

    expect(response.status).toBe(200);
    expect(mocks.updateAgentPaymentSettings).toHaveBeenCalledWith({ signalAmountCents: 25_000 });
    await expect(response.json()).resolves.toEqual({
      paymentConfigured: true,
      payment: { configured: true, recipientName: "Clinic", signalAmountCents: 25_000 },
    });
  });

  it("saves only manual details without submitting an amount", async () => {
    const response = await PUT(request({ pixKey: "new-key", recipientName: "Clinic" }));

    expect(response.status).toBe(200);
    expect(mocks.updateAgentPaymentSettings).toHaveBeenCalledWith({ pixKey: "new-key", recipientName: "Clinic" });
  });

  it("allows a blank key to preserve the stored key", async () => {
    expect((await PUT(request({ pixKey: "", recipientName: "Clinic" }))).status).toBe(200);
    expect(mocks.updateAgentPaymentSettings).toHaveBeenCalledWith({ pixKey: "", recipientName: "Clinic" });
  });

  it.each([
    {},
    { unknown: "value" },
    { pixKey: null },
    { recipientName: 1 },
    { recipientName: "   " },
    { signalAmountCents: "25000" },
    { signalAmountCents: null },
  ])("rejects malformed partial settings: %j", async (payment) => {
    expect((await PUT(request(payment))).status).toBe(400);
    expect(mocks.updateAgentPaymentSettings).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    expect((await PUT(request({ signalAmountCents: 25_000 }))).status).toBe(401);
    expect(mocks.updateAgentPaymentSettings).not.toHaveBeenCalled();
  });

  it("surfaces repository validation errors", async () => {
    mocks.updateAgentPaymentSettings.mockRejectedValue(new Error("Invalid amount"));

    const response = await PUT(request({ signalAmountCents: 0 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid amount" });
  });
});
