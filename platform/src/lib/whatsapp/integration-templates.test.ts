import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppTemplate } from "./templates";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(), customer: vi.fn(), send: vi.fn(), save: vi.fn(),
  updateStatus: vi.fn(), cancelJob: vi.fn(),
}));
vi.mock("../crm/customers", () => ({
  findOrCreateCustomerFromWhatsApp: mocks.customer, updateCustomerServiceStatus: mocks.updateStatus,
}));
vi.mock("../automation/queue", () => ({ cancelAutomationJob: mocks.cancelJob }));
vi.mock("./client", () => ({ sendWhatsAppTemplate: mocks.send }));
vi.mock("./messages", () => ({ saveWhatsAppMessage: mocks.save }));
vi.mock("./embedded-signup", () => ({ getOperationalEmbeddedSignupConfig: vi.fn() }));
vi.mock("./templates", async importOriginal => ({
  ...await importOriginal<typeof import("./templates")>(), listWhatsAppTemplates: mocks.catalog,
}));

import { legacyCompanyId } from "../companies/ownership";
import { parseIntegrationTemplateRequest, sendIntegrationTemplate } from "./integration-templates";
import { WhatsAppTemplatePersistenceError } from "./template-messages";

const customer = { _id: new ObjectId(), name: "Lead de teste" };
const template: WhatsAppTemplate = {
  id: "template-1", name: "lead_contato", language: "pt_BR", category: "UTILITY", status: "APPROVED",
  components: [
    { type: "BODY", text: "Olá! Aqui é a equipe do Dr. Matheus Busnardo.\n\n{{1}}\n\nToque no botão abaixo para continuar seu atendimento." },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Continuar Atendimento" }] },
  ],
};
function payload() {
  return {
    messaging_product: "whatsapp", to: "5542988076200", type: "template",
    template: {
      name: "lead_contato", language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: "mais informações da consulta" }] }],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.catalog.mockResolvedValue([template]);
  mocks.customer.mockResolvedValue(customer);
  mocks.send.mockResolvedValue({ messageId: "wamid.real", to: "5542988076200" });
  mocks.save.mockResolvedValue({ inserted: true });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("provider template send command validation", () => {
  it("maps the exact provider payload to the existing positional template sender", () => {
    expect(parseIntegrationTemplateRequest(payload())).toEqual({
      to: "5542988076200", name: "lead_contato", language: "pt_BR",
      parameters: { header: [], body: ["mais informações da consulta"], buttonUrls: [] },
    });
  });

  it.each([
    null, [], {}, "text",
    { object: "whatsapp_business_account", entry: [] },
    { ...payload(), messaging_product: "other" },
    { ...payload(), type: "text" },
    { ...payload(), to: 5542988076200 },
    { ...payload(), to: "+5542988076200" },
    { ...payload(), to: "1234" },
    { ...payload(), to: "1".repeat(16) },
    { ...payload(), recipient_type: "group" },
    { ...payload(), unexpected: true },
    { ...payload(), template: null },
    { ...payload(), template: { name: "lead_contato" } },
    { ...payload(), template: { ...payload().template, name: "Bad Name" } },
    { ...payload(), template: { ...payload().template, language: { code: "invalid" } } },
    { ...payload(), template: { ...payload().template, components: null } },
    { ...payload(), template: { ...payload().template, components: {} } },
    { ...payload(), template: { ...payload().template, components: [{ type: ["body"], parameters: [] }] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "footer", parameters: [] }] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "body", parameters: {} }] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "body", parameters: [null] }] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "body", parameters: [{ type: "image", image: { id: "media" } }] }] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "body", parameters: [{ type: "text", text: "value", parameter_name: "name" }] }] } },
    { ...payload(), template: { ...payload().template, components: [payload().template.components[0], payload().template.components[0]] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "button", sub_type: "url", index: "10", parameters: [{ type: "text", text: "value" }] }] } },
    { ...payload(), template: { ...payload().template, components: [{ type: "button", sub_type: "quick_reply", index: "0", parameters: [] }] } },
  ].map(input => ({ input })))("rejects malformed or unsupported input before external calls: %#", async ({ input }) => {
    await expect(sendIntegrationTemplate(input)).rejects.toMatchObject({ status: 400, code: "TEMPLATE_PAYLOAD_INVALID" });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("maps text headers and indexed URL buttons without accepting duplicate indexes", () => {
    const components = [
      { type: "header", parameters: [{ type: "text", text: "Maria" }] },
      { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "suffix" }] },
    ];
    expect(parseIntegrationTemplateRequest({
      ...payload(), template: { ...payload().template, components },
    }).parameters).toEqual({ header: ["Maria"], body: [], buttonUrls: [{ index: 1, value: "suffix" }] });
    expect(() => parseIntegrationTemplateRequest({
      ...payload(), template: { ...payload().template, components: [...components, components[1]] },
    })).toThrow("duplicados");
  });
});

describe("integration template delivery and history", () => {
  it("renders, sends and persists the actual template with its real Meta ID without handing the lead to humans", async () => {
    const result = await sendIntegrationTemplate(payload());
    expect(mocks.customer).toHaveBeenCalledWith({
      phone: "5542988076200", interactionAt: expect.any(Date), companyId: legacyCompanyId(),
    });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      to: "5542988076200", name: "lead_contato", language: "pt_BR",
      headerParameters: [], bodyParameters: ["mais informações da consulta"], buttonUrlParameters: [],
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      customerId: customer._id, contactName: customer.name, contactPhone: "5542988076200",
      metaMessageId: "wamid.real", direction: "outbound", type: "template",
      body: "Olá! Aqui é a equipe do Dr. Matheus Busnardo.\n\nmais informações da consulta\n\nToque no botão abaixo para continuar seu atendimento.\n\nOpções: Continuar Atendimento",
      templateName: "lead_contato", templateLanguage: "pt_BR", status: "sent", timestamp: expect.any(Date),
    });
    expect(result).toMatchObject({ messageId: "wamid.real", templateName: "lead_contato" });
    expect(result).not.toHaveProperty("sentBy");
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.cancelJob).not.toHaveBeenCalled();
  });

  it.each([
    [],
    [{ ...template, language: "en_US" }],
    [{ ...template, name: "other_template" }],
    [{ ...template, status: "PAUSED" }],
    [template, { ...template, id: "duplicate" }],
  ].map(catalog => ({ catalog })))("does not send an unavailable, unapproved or ambiguous template: %#", async ({ catalog }) => {
    mocks.catalog.mockResolvedValue(catalog);
    await expect(sendIntegrationTemplate(payload())).rejects.toMatchObject({ status: 409, code: "TEMPLATE_UNAVAILABLE" });
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([[], [{ type: "text", text: "" }], [{ type: "text", text: " ".repeat(5) }], [{ type: "text", text: "x".repeat(1025) }]].map(parameters => ({ parameters })))(
    "validates parameter counts and values before creating a customer or sending: %#", async ({ parameters }) => {
      await expect(sendIntegrationTemplate({
        ...payload(), template: { ...payload().template, components: [{ type: "body", parameters }] },
      })).rejects.toMatchObject({ status: 400, code: "TEMPLATE_PARAMETERS_INVALID" });
      expect(mocks.customer).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("rejects media headers before sending", async () => {
    mocks.catalog.mockResolvedValue([{ ...template, components: [...template.components, { type: "HEADER", format: "IMAGE" }] }]);
    await expect(sendIntegrationTemplate(payload())).rejects.toMatchObject({ status: 400, code: "TEMPLATE_PARAMETERS_INVALID" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects an unsupported catalog component before sending", async () => {
    mocks.catalog.mockResolvedValue([{ ...template, components: [...template.components, { type: "CAROUSEL" }] }]);
    await expect(sendIntegrationTemplate(payload())).rejects.toMatchObject({ status: 400, code: "TEMPLATE_PARAMETERS_INVALID" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("supports a static template without components in the command", async () => {
    mocks.catalog.mockResolvedValue([{ ...template, components: [{ type: "BODY", text: "Olá!" }] }]);
    await sendIntegrationTemplate({
      messaging_product: "whatsapp", to: "5542988076200", type: "template",
      template: { name: "lead_contato", language: { code: "pt_BR" } },
    });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ bodyParameters: [] }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ body: "Olá!" }));
  });

  it("does not send if the customer cannot be prepared", async () => {
    mocks.customer.mockRejectedValue(new Error("storage unavailable"));
    await expect(sendIntegrationTemplate(payload())).rejects.toThrow("storage unavailable");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not persist a sent message or retry when Meta sending fails", async () => {
    mocks.send.mockRejectedValue(new Error("private upstream error"));
    await expect(sendIntegrationTemplate(payload())).rejects.toMatchObject({ status: 502, code: "TEMPLATE_SEND_UNCONFIRMED" });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("awaits history persistence before reporting success", async () => {
    let release: () => void = () => { throw new Error("Persistence has not started"); };
    const pendingSave = new Promise<void>(resolve => { release = resolve; });
    mocks.save.mockReturnValue(pendingSave);
    let completed = false;
    const sending = sendIntegrationTemplate(payload()).then(result => { completed = true; return result; });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release();
    await expect(sending).resolves.toMatchObject({ messageId: "wamid.real" });
    expect(completed).toBe(true);
  });

  it("preserves the accepted Meta ID if history saving fails, without resending", async () => {
    mocks.save.mockRejectedValue(new Error("storage unavailable"));
    const sending = sendIntegrationTemplate(payload());
    await expect(sending).rejects.toBeInstanceOf(WhatsAppTemplatePersistenceError);
    await expect(sending).rejects.toMatchObject({ messageId: "wamid.real" });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not be persisted"), expect.objectContaining({ messageId: "wamid.real" }));
  });
});
