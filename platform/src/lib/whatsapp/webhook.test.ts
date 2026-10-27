import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureCoexistenceWebhookEvent,
  cancelAutomationJob,
  emitAutomationEvent,
  ensureWhatsAppMessageIndexes,
  findWhatsAppMessageByMetaId,
  findOrCreateCustomerFromWhatsApp,
  isOperationalEmbeddedSignupPhoneNumber,
  saveWhatsAppMessage,
  processWhatsAppMessageEchoes,
  updateWhatsAppMessageStatus,
  hydrateWhatsAppTemplateContext,
} = vi.hoisted(() => ({
  captureCoexistenceWebhookEvent: vi.fn(),
  cancelAutomationJob: vi.fn(),
  emitAutomationEvent: vi.fn(),
  ensureWhatsAppMessageIndexes: vi.fn(),
  findWhatsAppMessageByMetaId: vi.fn(),
  findOrCreateCustomerFromWhatsApp: vi.fn(),
  isOperationalEmbeddedSignupPhoneNumber: vi.fn(),
  saveWhatsAppMessage: vi.fn(),
  processWhatsAppMessageEchoes: vi.fn(),
  updateWhatsAppMessageStatus: vi.fn(),
  hydrateWhatsAppTemplateContext: vi.fn(),
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
  findWhatsAppMessageByMetaId,
  saveWhatsAppMessage,
  updateWhatsAppMessageStatus,
}));
vi.mock("./message-echoes", () => ({ processWhatsAppMessageEchoes }));
vi.mock("./template-context", () => ({ hydrateWhatsAppTemplateContext }));

import { processWhatsAppWebhook } from "./webhook";

describe("WhatsApp webhook isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1111111111";
    ensureWhatsAppMessageIndexes.mockResolvedValue(undefined);
    captureCoexistenceWebhookEvent.mockResolvedValue(true);
    isOperationalEmbeddedSignupPhoneNumber.mockResolvedValue(null);
    emitAutomationEvent.mockResolvedValue(["customer_agent"]);
    findWhatsAppMessageByMetaId.mockResolvedValue(null);
  });

  it("captures history without creating customers or triggering AI", async () => {
    const result = await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: "2222222222",
        changes: [{ field: "history", value: { history: [{ threads: [] }] } }],
      }],
    }));

    expect(result).toEqual({ receivedMessages: 0, statusUpdates: 0, coexistenceEvents: 1, processingRequests: 0 });
    expect(captureCoexistenceWebhookEvent).toHaveBeenCalledOnce();
    expect(findOrCreateCustomerFromWhatsApp).not.toHaveBeenCalled();
    expect(emitAutomationEvent).not.toHaveBeenCalled();
  });

  it("archives and projects outbound echoes without scheduling an AI reply", async () => {
    const value = {
      metadata: { phone_number_id: "1111111111" },
      message_echoes: [{ id: "wamid.external", to: "5511999999999", type: "text", text: { body: "Manual" } }],
    };
    await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "2222222222", changes: [{ field: "smb_message_echoes", value }] }],
    }));
    expect(processWhatsAppMessageEchoes).toHaveBeenCalledWith({ wabaId: "2222222222", value });
    expect(captureCoexistenceWebhookEvent.mock.invocationCallOrder[0])
      .toBeLessThan(processWhatsAppMessageEchoes.mock.invocationCallOrder[0]);
    expect(emitAutomationEvent).not.toHaveBeenCalled();
    expect(findOrCreateCustomerFromWhatsApp).not.toHaveBeenCalled();
  });

  it("propagates echo projection failures so Meta can retry", async () => {
    processWhatsAppMessageEchoes.mockRejectedValueOnce(new Error("WHATSAPP_ECHO_INVALID_PAYLOAD"));
    await expect(processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "2222222222", changes: [{ field: "smb_message_echoes", value: {} }] }],
    }))).rejects.toThrow("WHATSAPP_ECHO_INVALID_PAYLOAD");
  });

  it("hydrates an explicitly supplied template reference and actual values before storing it", async () => {
    const reference = { name: "confirmation", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "26/10" }] }] };
    hydrateWhatsAppTemplateContext.mockResolvedValueOnce({
      body: "Confirma a consulta em 26/10?\n\nOpções: Confirmar | Reagendar",
      templateName: "confirmation", templateLanguage: "pt_BR",
    });
    findOrCreateCustomerFromWhatsApp.mockResolvedValue({ _id: { toString: () => "customer-1" } });
    saveWhatsAppMessage.mockResolvedValue({ inserted: true });
    await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "2222222222", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "1111111111" },
        messages: [{ id: "wamid.template", from: "5511999999999", type: "template", template: reference }],
      } }] }],
    }));
    expect(hydrateWhatsAppTemplateContext).toHaveBeenCalledWith(expect.anything(), "2222222222", reference);
    expect(saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "template", templateName: "confirmation", templateLanguage: "pt_BR",
      body: "Confirma a consulta em 26/10?\n\nOpções: Confirmar | Reagendar",
    }));
  });

  it("stores an ad greeting and referral with the customer's actual message, triggering automation only once", async () => {
    findOrCreateCustomerFromWhatsApp.mockResolvedValue({ _id: { toString: () => "customer-1" }, serviceStatus: "ai_active" });
    saveWhatsAppMessage.mockResolvedValueOnce({ inserted: true }).mockResolvedValueOnce({ inserted: false });
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "2222222222", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "1111111111" },
        messages: [{
          id: "wamid.ad", from: "5511999999999", type: "text",
          text: { body: "Oi quero saber mais sobre o projeto verão" },
          referral: {
            source_type: "ad", source_id: "ad-123", source_url: "https://www.instagram.com/p/example/",
            headline: "Projeto verão", body: "Conheça o projeto.",
            welcome_message: { text: "Oi! Como podemos ajudar?" },
            media_type: "image", image_url: "https://cdn.example/ad.jpg", ctwa_clid: "click-123",
          },
        }],
      } }] }],
    });
    expect((await processWhatsAppWebhook(raw)).receivedMessages).toBe(1);
    expect(saveWhatsAppMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      metaMessageId: "wamid.ad", direction: "inbound", type: "text",
      body: "Oi quero saber mais sobre o projeto verão",
      referral: {
        sourceType: "ad", sourceId: "ad-123", sourceUrl: "https://www.instagram.com/p/example/",
        headline: "Projeto verão", body: "Conheça o projeto.", welcomeMessage: "Oi! Como podemos ajudar?",
        mediaType: "image", imageUrl: "https://cdn.example/ad.jpg", ctwaClid: "click-123",
      },
    }));
    await processWhatsAppWebhook(raw);
    expect(emitAutomationEvent).toHaveBeenCalledOnce();
    expect(cancelAutomationJob).toHaveBeenCalledOnce();
    expect(hydrateWhatsAppTemplateContext).not.toHaveBeenCalled();
  });

  it("rejects malformed referral context before customer or automation mutations", async () => {
    await expect(processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "1111111111" },
        messages: [{ id: "wamid.bad-ad", from: "5511999999999", type: "text", referral: { welcome_message: { text: 123 } } }],
      } }] }],
    }))).rejects.toThrow("WHATSAPP_REFERRAL_INVALID_PAYLOAD");
    expect(findOrCreateCustomerFromWhatsApp).not.toHaveBeenCalled();
    expect(saveWhatsAppMessage).not.toHaveBeenCalled();
    expect(emitAutomationEvent).not.toHaveBeenCalled();
  });

  it.each([
    { type: "button", button: { text: "Confirmar", payload: "confirm-appointment-123" }, expected: { type: "button", title: "Confirmar", payload: "confirm-appointment-123" } },
    { type: "interactive", interactive: { button_reply: { title: "Confirmar", id: "option-1" } }, expected: { type: "button_reply", title: "Confirmar", id: "option-1" } },
    { type: "interactive", interactive: { list_reply: { title: "10h", id: "slot-1" } }, expected: { type: "list_reply", title: "10h", id: "slot-1" } },
  ])("preserves actual button/list selection metadata and its original message reference", async item => {
    findOrCreateCustomerFromWhatsApp.mockResolvedValue({ _id: { toString: () => "customer-1" }, serviceStatus: "ai_active" });
    saveWhatsAppMessage.mockResolvedValue({ inserted: true });
    findWhatsAppMessageByMetaId.mockResolvedValueOnce({ direction: "outbound", type: "template", body: "Consulta em 26/10. Confirmar ou reagendar?" });
    await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "2222222222", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "1111111111" },
        messages: [{ id: "wamid.selection", from: "5511999999999", type: item.type, button: item.button, interactive: item.interactive, context: { id: "wamid.original" } }],
      } }] }],
    }));
    expect(saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      selection: item.expected,
      replyTo: { metaMessageId: "wamid.original", direction: "outbound", type: "template", body: "Consulta em 26/10. Confirmar ou reagendar?" },
    }));
  });

  it("rejects unresolved template context before creating a customer or triggering AI", async () => {
    hydrateWhatsAppTemplateContext.mockRejectedValueOnce(new Error("WHATSAPP_TEMPLATE_PARAMETERS_MISSING_OR_EXTRA"));
    await expect(processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "2222222222", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "1111111111" },
        messages: [{ id: "wamid.unresolved", from: "5511999999999", type: "template", template: { name: "confirmation" } }],
      } }] }],
    }))).rejects.toThrow("WHATSAPP_TEMPLATE_PARAMETERS_MISSING_OR_EXTRA");
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
    expect(emitAutomationEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "message.received" }), { immediate: true });
  });

  it("preserves image metadata and the quoted message snapshot", async () => {
    isOperationalEmbeddedSignupPhoneNumber.mockResolvedValue(true);
    const customerId = { toString: () => "customer-1" };
    findOrCreateCustomerFromWhatsApp.mockResolvedValue({ _id: customerId, serviceStatus: "ai_active" });
    findWhatsAppMessageByMetaId.mockResolvedValue({
      metaMessageId: "wamid.original",
      direction: "outbound",
      type: "text",
      body: "Envie uma foto do comprovante.",
    });
    saveWhatsAppMessage.mockResolvedValue({ inserted: true });

    const result = await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "1111111111" },
            messages: [{
              id: "wamid.image",
              from: "5511999999999",
              type: "image",
              context: { id: "wamid.original" },
              image: {
                id: "media-123",
                mime_type: "image/jpeg",
                sha256: "hash-123",
                caption: "Aqui está",
              },
            }],
          },
        }],
      }],
    }));

    expect(saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "image",
      body: "Aqui está",
      media: {
        id: "media-123",
        mimeType: "image/jpeg",
        sha256: "hash-123",
        caption: "Aqui está",
      },
      replyTo: {
        metaMessageId: "wamid.original",
        body: "Envie uma foto do comprovante.",
        direction: "outbound",
        type: "text",
      },
    }));
    expect(result.processingRequests).toBe(1);
  });

  it("preserves WhatsApp voice-message metadata and triggers the agent", async () => {
    isOperationalEmbeddedSignupPhoneNumber.mockResolvedValue(true);
    const customerId = { toString: () => "customer-1" };
    findOrCreateCustomerFromWhatsApp.mockResolvedValue({ _id: customerId, serviceStatus: "ai_active" });
    saveWhatsAppMessage.mockResolvedValue({ inserted: true });

    const result = await processWhatsAppWebhook(JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "1111111111" },
            messages: [{
              id: "wamid.audio",
              from: "5511999999999",
              type: "audio",
              audio: {
                id: "audio-123",
                mime_type: "audio/ogg; codecs=opus",
                sha256: "audio-hash",
                voice: true,
              },
            }],
          },
        }],
      }],
    }));

    expect(saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "audio",
      body: "[audio]",
      media: {
        id: "audio-123",
        mimeType: "audio/ogg; codecs=opus",
        sha256: "audio-hash",
      },
    }));
    expect(emitAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message.received", customerId }),
      { immediate: true },
    );
    expect(result.processingRequests).toBe(1);
  });
});