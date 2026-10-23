import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  updateAgentPaymentSettings: vi.fn(),
  getAgentConfiguration: vi.fn(),
  clearDynamicData: vi.fn(),
  clearDynamicDataForCustomer: vi.fn(),
  clearChatHistoryForCustomer: vi.fn(),
  ChatHistoryInProgressError: class extends Error {},
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/admin/database", () => ({
  clearDynamicData: mocks.clearDynamicData,
  clearDynamicDataForCustomer: mocks.clearDynamicDataForCustomer,
  clearChatHistoryForCustomer: mocks.clearChatHistoryForCustomer,
  ChatHistoryInProgressError: mocks.ChatHistoryInProgressError,
}));
vi.mock("@/lib/assistant/agent", () => ({
  getAgentConfiguration: mocks.getAgentConfiguration,
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

import { DELETE, PUT } from "./route";

function request(payment: unknown) {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment }),
  });
}

describe("customer history deletion API", () => {
    const customerId = new ObjectId().toHexString();
    const input = { confirmation: "APAGAR", scope: "customer_history", customerId };
    function deletionRequest(body: unknown = input) {
      return new Request("http://localhost/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.getServerSession.mockResolvedValue({ user: { email: "team@example.com" } });
      mocks.getAgentConfiguration.mockResolvedValue({ enabled: false });
      mocks.clearChatHistoryForCustomer.mockResolvedValue({
        whatsapp_messages: 4, assistant_conversation_states: 1,
      });
      mocks.clearDynamicDataForCustomer.mockResolvedValue({ crm_customers: 1 });
      mocks.clearDynamicData.mockResolvedValue({ whatsapp_messages: 10 });
    });

    it("deletes only the selected customer's conversation through the dedicated helper", async () => {
      const response = await DELETE(deletionRequest());

      expect(response.status).toBe(200);
      expect(mocks.clearChatHistoryForCustomer).toHaveBeenCalledExactlyOnceWith(new ObjectId(customerId));
      expect(mocks.clearDynamicDataForCustomer).not.toHaveBeenCalled();
      expect(mocks.clearDynamicData).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        deleted: { whatsapp_messages: 4, assistant_conversation_states: 1 },
        deletedCount: 5,
        scope: "customer_history",
      });
    });

    it("requires authentication", async () => {
      mocks.getServerSession.mockResolvedValue(null);

      expect((await DELETE(deletionRequest())).status).toBe(401);
      expect(mocks.clearChatHistoryForCustomer).not.toHaveBeenCalled();
    });

    it("requires the explicit deletion confirmation", async () => {
      expect((await DELETE(deletionRequest({ ...input, confirmation: "" }))).status).toBe(400);
      expect(mocks.clearChatHistoryForCustomer).not.toHaveBeenCalled();
      expect(mocks.getAgentConfiguration).not.toHaveBeenCalled();
    });

    it("requires paused AI processing", async () => {
      mocks.getAgentConfiguration.mockResolvedValue({ enabled: true });

      expect((await DELETE(deletionRequest())).status).toBe(409);
      expect(mocks.clearChatHistoryForCustomer).not.toHaveBeenCalled();
    });

    it.each([undefined, null, "", "not-an-id", 123])("rejects a missing or invalid customer ID: %s", async (id) => {
      expect((await DELETE(deletionRequest({ ...input, customerId: id }))).status).toBe(400);
      expect(mocks.clearChatHistoryForCustomer).not.toHaveBeenCalled();
      expect(mocks.clearDynamicDataForCustomer).not.toHaveBeenCalled();
      expect(mocks.clearDynamicData).not.toHaveBeenCalled();
    });

    it.each([null, [], 42])("rejects a malformed deletion object: %j", async (body) => {
      expect((await DELETE(deletionRequest(body))).status).toBe(400);
      expect(mocks.clearDynamicData).not.toHaveBeenCalled();
    });

    it("never interprets an unknown scope as permission to delete everything", async () => {
      expect((await DELETE(deletionRequest({ ...input, scope: "all_history" }))).status).toBe(400);
      expect(mocks.clearChatHistoryForCustomer).not.toHaveBeenCalled();
      expect(mocks.clearDynamicData).not.toHaveBeenCalled();
    });

    it("reports an unknown customer without falling back to broad deletion", async () => {
      mocks.clearChatHistoryForCustomer.mockResolvedValue(null);

      expect((await DELETE(deletionRequest())).status).toBe(404);
      expect(mocks.clearDynamicData).not.toHaveBeenCalled();
    });

    it("returns a conflict when conversation processing is still running", async () => {
      mocks.clearChatHistoryForCustomer.mockRejectedValueOnce(new mocks.ChatHistoryInProgressError("Customer is busy"));

      const response = await DELETE(deletionRequest());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "Customer is busy" });
    });

    it("surfaces cleanup failures rather than returning success", async () => {
      const error = new Error("Database failure");
      mocks.clearChatHistoryForCustomer.mockRejectedValueOnce(error);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await DELETE(deletionRequest());
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: "Não foi possível concluir a exclusão. Tente novamente." });
        expect(log).toHaveBeenCalledWith("Failed to delete operational data", error);
      } finally {
        log.mockRestore();
      }
    });

    it.each(["customer", "all"])("preserves the existing %s deletion behavior", async (scope) => {
      const response = await DELETE(deletionRequest({ ...input, scope }));

      expect(response.status).toBe(200);
      expect(mocks.clearChatHistoryForCustomer).not.toHaveBeenCalled();
      if (scope === "customer") {
        expect(mocks.clearDynamicDataForCustomer).toHaveBeenCalledWith(new ObjectId(customerId));
        expect(mocks.clearDynamicData).not.toHaveBeenCalled();
      } else {
        expect(mocks.clearDynamicData).toHaveBeenCalledOnce();
        expect(mocks.clearDynamicDataForCustomer).not.toHaveBeenCalled();
      }
    });
});

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
