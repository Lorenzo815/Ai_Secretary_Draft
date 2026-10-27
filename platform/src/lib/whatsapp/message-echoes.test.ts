import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";
import type { WebhookMessage } from "./message-payload";

const mocks = vi.hoisted(() => ({
  bindings: vi.fn(), activeCompany: vi.fn(), archive: vi.fn(), pending: vi.fn(), remaining: vi.fn(),
  createIndex: vi.fn(), customer: vi.fn(), reference: vi.fn(), save: vi.fn(),
  hydrate: vi.fn(),
}));
vi.mock("../mongodb", () => ({
  getMongoClient: async () => ({ db: () => ({ collection: (name: string) => {
    if (name === "companies") return { findOne: mocks.activeCompany };
    if (name === "whatsapp_embedded_signup_connections") return {
      find: () => ({ toArray: mocks.bindings }),
    };
    if (name === "whatsapp_coexistence_webhook_events") return {
      updateOne: mocks.archive, createIndex: mocks.createIndex, findOne: mocks.remaining,
      find: mocks.pending,
    };
    throw new Error(`Unexpected collection: ${name}`);
  } }) }),
}));
vi.mock("../crm/customers", () => ({ findOrCreateCustomerFromWhatsApp: mocks.customer }));
vi.mock("./messages", () => ({
  findWhatsAppMessageByMetaId: mocks.reference, saveWhatsAppMessageEcho: mocks.save,
}));
vi.mock("./template-context", () => ({ hydrateWhatsAppTemplateContext: mocks.hydrate }));

import { processPendingWhatsAppMessageEchoes, processWhatsAppMessageEchoes } from "./message-echoes";
import { coexistenceWebhookEventId } from "./embedded-signup";

const customerId = new ObjectId();
const companyId = legacyCompanyId();
const phone = "5511999999999";
const timestamp = new Date("2026-10-25T18:00:00Z");
const echo: WebhookMessage = {
  id: "wamid.external", from: "5542999999999", to: phone,
  timestamp: String(timestamp.getTime() / 1000), type: "text", text: { body: "Manual answer" },
};
function input(messages: WebhookMessage[] = [echo]) {
  return { wabaId: "waba-1", value: { metadata: { phone_number_id: "phone-1" }, message_echoes: messages } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
  mocks.bindings.mockResolvedValue([{
    _id: "connection", companyId, wabaId: "waba-1", phoneNumberId: "phone-1", status: "operational",
  }]);
  mocks.activeCompany.mockResolvedValue({ _id: companyId, status: "active" });
  mocks.customer.mockResolvedValue({ _id: customerId });
  mocks.reference.mockResolvedValue(null);
  mocks.save.mockResolvedValue({ inserted: true });
  mocks.pending.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) });
  mocks.remaining.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("WhatsApp Business app echo ingestion", () => {
  it("resolves the recipient within the company and marks the archive only after saving", async () => {
    await processWhatsAppMessageEchoes(input());
    expect(mocks.customer).toHaveBeenCalledWith({ phone, interactionAt: timestamp, companyId });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      customerId, metaMessageId: echo.id, contactPhone: phone, direction: "outbound",
      body: "Manual answer", timestamp, source: "whatsapp_business_app",
      externalActivity: { messageId: echo.id, timestamp },
    }), undefined);
    expect(mocks.archive).toHaveBeenCalledWith({
      _id: coexistenceWebhookEventId({ ...input(), field: "smb_message_echoes" }),
      companyId, field: "smb_message_echoes",
    }, { $set: { processedAt: expect.any(Date) }, $unset: { processingError: "", nextAttemptAt: "" } });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.archive.mock.invocationCallOrder[0]);
  });

  it("preserves media and quoted message metadata without leaking a different company's reference", async () => {
    mocks.reference.mockResolvedValue({ direction: "inbound", body: "Question", type: "text" });
    await processWhatsAppMessageEchoes(input([{
      ...echo, type: "image", text: undefined, context: { id: "wamid.question" },
      image: { id: "image-1", mime_type: "image/jpeg", sha256: "hash", caption: "Photo" },
    }]));
    expect(mocks.reference).toHaveBeenCalledWith("wamid.question", companyId);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      body: "Photo",
      media: { id: "image-1", mimeType: "image/jpeg", sha256: "hash", caption: "Photo" },
      replyTo: { metaMessageId: "wamid.question", body: "Question", direction: "inbound", type: "text" },
    }), undefined);
  });

  it.each(["edit", "revoke"] as const)("projects %s onto the original message", async kind => {
    await processWhatsAppMessageEchoes(input([{
      ...echo, type: kind,
      edit: { original_message_id: "wamid.original", message: { type: "text", text: { body: "Corrected" } } },
      revoke: { original_message_id: "wamid.original" },
    }]));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      metaMessageId: "wamid.original",
      type: kind === "edit" ? "text" : "revoked",
      body: kind === "edit" ? "Corrected" : "Mensagem removida no WhatsApp.",
      externalActivity: { messageId: echo.id, timestamp },
    }), kind);
  });

  it("enriches a template echo only when explicit template data is supplied", async () => {
    const template = { name: "confirmation", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "26/10" }] }] };
    mocks.hydrate.mockResolvedValueOnce({ body: "Confirma 26/10?", templateName: "confirmation", templateLanguage: "pt_BR" });
    await processWhatsAppMessageEchoes(input([{ ...echo, type: "template", template }]));
    expect(mocks.hydrate).toHaveBeenCalledWith(companyId, "waba-1", template);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      body: "Confirma 26/10?", templateName: "confirmation", templateLanguage: "pt_BR",
    }), undefined);
  });

  it("preserves referral context when an echo actually supplies it", async () => {
    await processWhatsAppMessageEchoes(input([{
      ...echo, referral: { source_type: "ad", source_id: "ad-123", welcome_message: { text: "Hello" } },
    }]));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      body: "Manual answer", referral: { sourceType: "ad", sourceId: "ad-123", welcomeMessage: "Hello" },
    }), undefined);
  });

  it("keeps unresolved template echoes unprocessed rather than saving guessed text", async () => {
    mocks.hydrate.mockRejectedValueOnce(new Error("WHATSAPP_TEMPLATE_PARAMETERS_MISSING_OR_EXTRA"));
    await expect(processWhatsAppMessageEchoes(input([{ ...echo, type: "template", template: { name: "confirmation" } }])))
      .rejects.toThrow("WHATSAPP_TEMPLATE_PARAMETERS_MISSING_OR_EXTRA");
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each(["wrong-waba", "wrong-phone", "foreign-company", "ambiguous", "inactive-company"])(
    "rejects %s without creating customers or writing messages", async scenario => {
      if (scenario === "wrong-waba") mocks.bindings.mockResolvedValue([]);
      if (scenario === "wrong-phone") mocks.bindings.mockResolvedValue([{
        _id: "connection", companyId, wabaId: "waba-1", phoneNumberId: "other", status: "operational",
      }]);
      if (scenario === "foreign-company" || scenario === "ambiguous") {
        const foreign = { _id: "foreign", companyId: new ObjectId(), wabaId: "waba-1", phoneNumberId: "phone-1", status: "operational" };
        mocks.bindings.mockResolvedValue(scenario === "ambiguous"
          ? [foreign, { ...foreign, _id: "own", companyId }]
          : [foreign]);
      }
      if (scenario === "inactive-company") mocks.activeCompany.mockResolvedValue(null);
      await expect(processWhatsAppMessageEchoes(input())).rejects.toThrow();
      expect(mocks.customer).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    },
  );

  it("accepts only an explicit matching environment binding", async () => {
    mocks.bindings.mockResolvedValue([]);
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "waba-1");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-1");
    await processWhatsAppMessageEchoes(input());
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("ignores client-provided company ownership", async () => {
    const payload = input();
    await processWhatsAppMessageEchoes({ ...payload, value: { ...payload.value, companyId: new ObjectId().toHexString() } });
    expect(mocks.customer).toHaveBeenCalledWith(expect.objectContaining({ companyId }));
  });

  it.each([
    { ...echo, to: undefined },
    { ...echo, timestamp: "invalid" },
    { ...echo, timestamp: "Infinity" },
    { ...echo, type: "edit", edit: {} },
    { ...echo, type: "revoke", revoke: {} },
  ])("keeps malformed messages unprocessed", async malformed => {
    await expect(processWhatsAppMessageEchoes(input([malformed]))).rejects.toThrow("WHATSAPP_ECHO_INVALID");
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not acknowledge partial projection failures", async () => {
    mocks.save.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(processWhatsAppMessageEchoes(input())).rejects.toThrow();
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});

describe("archived echo recovery", () => {
  it("limits and scopes the sweep and includes Brazilian phone aliases for a contact", async () => {
    const result = await processPendingWhatsAppMessageEchoes([phone]);
    expect(mocks.pending).toHaveBeenCalledWith({
      companyId, field: "smb_message_echoes", processedAt: null,
      "value.message_echoes.to": { $in: [phone, "551199999999"] },
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: expect.any(Date) } }],
    });
    expect(result).toEqual({ processed: 0, failed: 0, pending: false });
  });

  it("records sanitized failures and continues with other archived events", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const event = { ...input(), _id: "event-1", companyId, field: "smb_message_echoes", processedAt: null };
    mocks.pending.mockReturnValue({
      sort: () => ({ limit: () => ({ toArray: async () => [event, { ...event, _id: "event-2" }] }) }),
    });
    mocks.save.mockRejectedValueOnce(new Error("secret connection or message content"));
    mocks.remaining.mockResolvedValue({ _id: "event-1" });
    expect(await processPendingWhatsAppMessageEchoes()).toEqual({ processed: 1, failed: 1, pending: true });
    expect(mocks.archive).toHaveBeenCalledWith({ _id: "event-1", companyId }, {
      $set: { processingError: "Error", nextAttemptAt: expect.any(Date) },
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret connection");
  });
});
