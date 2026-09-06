import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureCoexistenceWebhookEvent,
  cancelAutomationJob,
  emitAutomationEvent,
  ensureWhatsAppMessageIndexes,
  findOrCreateCustomerFromWhatsApp,
  isOperationalEmbeddedSignupPhoneNumber,
  saveWhatsAppMessage,
  updateWhatsAppMessageStatus,
} = vi.hoisted(() => ({
  captureCoexistenceWebhookEvent: vi.fn(),
  cancelAutomationJob: vi.fn(),
  emitAutomationEvent: vi.fn(),
  ensureWhatsAppMessageIndexes: vi.fn(),
  findOrCreateCustomerFromWhatsApp: vi.fn(),
  isOperationalEmbeddedSignupPhoneNumber: vi.fn(),
  saveWhatsAppMessage: vi.fn(),
  updateWhatsAppMessageStatus: vi.fn(),
}));

vi.mock("../automation", () => ({ cancelAutomationJob, emitAutomationEvent }));
vi.mock("../crm", () => ({ findOrCreateCustomerFromWhatsApp }));
vi.mock("./embedded-signup", () => ({
  captureCoexistenceWebhookEvent,
  COEXISTENCE_WEBHOOK_FIELDS: new Set([
    "account_update",
    "history",
    "smb_app_state_sync",
    "smb_message_echoes",
  ]),
  isOperationalEmbeddedSignupPhoneNumber,
}));
vi.mock("./messages", () => ({
  ensureWhatsAppMessageIndexes,
  saveWhatsAppMessage,
  updateWhatsAppMessageStatus,
}));

import { processWhatsAppWebhook } from "./webhook";

describe("WhatsApp webhook isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1111111111";
    ensureWhatsAppMessageIndexes.mockResolvedValue(undefined);
    captureCoexistenceWebhookEvent.mockResolvedValue(true);
    isOperationalEmbeddedSignupPhoneNumber.mockResolvedValue(null);
  });

  it("captures history without creating customers or triggering AI", async () => {
    const result = await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: "2222222222",
        changes: [{ field: "history", value: { history: [{ threads: [] }] } }],
      }],
    }));

    expect(result).toEqual({ receivedMessages: 0, statusUpdates: 0, coexistenceEvents: 1 });
    expect(captureCoexistenceWebhookEvent).toHaveBeenCalledOnce();
    expect(findOrCreateCustomerFromWhatsApp).not.toHaveBeenCalled();
    expect(emitAutomationEvent).not.toHaveBeenCalled();
  });

  it("ignores live messages for a phone number that is not operational", async () => {
    isOperationalEmbeddedSignupPhoneNumber.mockResolvedValue(false);
    const result = await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: "2222222222",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "3333333333" },
            messages: [{ id: "wamid.test", from: "5511999999999", type: "text", text: { body: "Olá" } }],
          },
        }],
      }],
    }));

    expect(result.receivedMessages).toBe(0);
    expect(findOrCreateCustomerFromWhatsApp).not.toHaveBeenCalled();
    expect(saveWhatsAppMessage).not.toHaveBeenCalled();
    expect(emitAutomationEvent).not.toHaveBeenCalled();
  });

  it("cancels a pending follow-up before scheduling the reply job", async () => {
    isOperationalEmbeddedSignupPhoneNumber.mockResolvedValue(true);
    const customerId = { toString: () => "customer-1" };
    findOrCreateCustomerFromWhatsApp.mockResolvedValue({ _id: customerId, serviceStatus: "ai_active" });
    saveWhatsAppMessage.mockResolvedValue({ inserted: true });

    await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: "2222222222",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "1111111111" },
            contacts: [{ profile: { name: "Cliente" } }],
            messages: [{ id: "wamid.reply", from: "5511999999999", timestamp: "1788700000", type: "text", text: { body: "Tenho interesse" } }],
          },
        }],
      }],
    }));

    expect(cancelAutomationJob).toHaveBeenCalledWith("customer_follow_up", customerId);
    expect(cancelAutomationJob.mock.invocationCallOrder[0]).toBeLessThan(emitAutomationEvent.mock.invocationCallOrder[0]);
  });
});