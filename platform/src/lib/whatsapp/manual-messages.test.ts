import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelAutomationJob: vi.fn(),
  findCustomerById: vi.fn(),
  updateCustomerServiceStatus: vi.fn(),
  findLatestInboundWhatsAppMessage: vi.fn(),
  saveWhatsAppMessage: vi.fn(),
  sendTextMessage: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  listWhatsAppTemplates: vi.fn(),
}));

vi.mock("../automation/queue", () => ({ cancelAutomationJob: mocks.cancelAutomationJob }));
vi.mock("../crm", () => ({
  findCustomerById: mocks.findCustomerById,
  updateCustomerServiceStatus: mocks.updateCustomerServiceStatus,
}));
vi.mock("./client", () => ({
  sendTextMessage: mocks.sendTextMessage,
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));
vi.mock("./messages", () => ({
  findLatestInboundWhatsAppMessage: mocks.findLatestInboundWhatsAppMessage,
  saveWhatsAppMessage: mocks.saveWhatsAppMessage,
}));
vi.mock("./templates", () => ({
  listWhatsAppTemplates: mocks.listWhatsAppTemplates,
  validateWhatsAppTemplateSendParameters: vi.fn((_template, parameters) => parameters),
  renderWhatsAppTemplateBody: vi.fn(() => "Olá, Maria. Confirme seu atendimento."),
}));

import { sendManualCustomerMessage, sendManualCustomerTemplate } from "./manual-messages";

describe("manual WhatsApp messages", () => {
  const customerId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerById.mockResolvedValue({
      _id: customerId,
      name: "Cliente Teste",
      phones: ["5511999999999"],
    });
  });

  it("sends to the latest inbound phone and hands the conversation to staff", async () => {
    mocks.findLatestInboundWhatsAppMessage.mockResolvedValue({
      contactPhone: "5511888888888",
      timestamp: new Date(Date.now() - 60 * 60_000),
    });
    mocks.sendTextMessage.mockResolvedValue({
      messageId: "wamid.test",
      to: "5511888888888",
      body: "Mensagem de revisão",
    });

    await sendManualCustomerMessage({
      customerId,
      body: "Mensagem de revisão",
      sentBy: "admin@example.com",
    });

    expect(mocks.sendTextMessage).toHaveBeenCalledWith({
      to: "5511888888888",
      body: "Mensagem de revisão",
    });
    expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "human_active");
    expect(mocks.cancelAutomationJob).toHaveBeenCalledTimes(2);
    expect(mocks.saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      customerId,
      metaMessageId: "wamid.test",
      sentBy: "admin@example.com",
      status: "sent",
    }));
  });

  it("does not send when the 24-hour service window has expired", async () => {
    mocks.findLatestInboundWhatsAppMessage.mockResolvedValue({
      contactPhone: "5511888888888",
      timestamp: new Date(Date.now() - 25 * 60 * 60_000),
    });

    await expect(sendManualCustomerMessage({
      customerId,
      body: "Mensagem fora da janela",
      sentBy: "admin@example.com",
    })).rejects.toMatchObject({ code: "SERVICE_WINDOW_CLOSED", status: 409 });
    expect(mocks.sendTextMessage).not.toHaveBeenCalled();
    expect(mocks.updateCustomerServiceStatus).not.toHaveBeenCalled();
  });

  it("sends an approved template even when the 24-hour window has expired", async () => {
    mocks.findLatestInboundWhatsAppMessage.mockResolvedValue({
      contactPhone: "5511888888888",
      timestamp: new Date(Date.now() - 25 * 60 * 60_000),
    });
    mocks.listWhatsAppTemplates.mockResolvedValue([{
      id: "template-1",
      name: "lembrete_agendamento",
      language: "pt_BR",
      status: "APPROVED",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Olá, {{1}}. Confirme seu atendimento." }],
    }]);
    mocks.sendWhatsAppTemplate.mockResolvedValue({ messageId: "wamid.template", to: "5511888888888" });

    const result = await sendManualCustomerTemplate({
      customerId,
      templateId: "template-1",
      parameters: { header: [], body: ["Maria"], buttonUrls: [] },
      sentBy: "admin@example.com",
    });

    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: "5511888888888",
      name: "lembrete_agendamento",
      language: "pt_BR",
      bodyParameters: ["Maria"],
    }));
    expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "human_active");
    expect(mocks.cancelAutomationJob).toHaveBeenCalledTimes(2);
    expect(mocks.saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "template",
      templateName: "lembrete_agendamento",
      body: "Olá, Maria. Confirme seu atendimento.",
    }));
    expect(result).toMatchObject({ messageId: "wamid.template", templateName: "lembrete_agendamento" });
  });

  it("does not send a template that is no longer approved", async () => {
    mocks.findLatestInboundWhatsAppMessage.mockResolvedValue(null);
    mocks.listWhatsAppTemplates.mockResolvedValue([{
      id: "template-1",
      name: "lembrete_agendamento",
      language: "pt_BR",
      status: "PAUSED",
      category: "UTILITY",
      components: [],
    }]);

    await expect(sendManualCustomerTemplate({
      customerId,
      templateId: "template-1",
      parameters: { header: [], body: [], buttonUrls: [] },
      sentBy: "admin@example.com",
    })).rejects.toMatchObject({ code: "TEMPLATE_INVALID", status: 409 });
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(mocks.updateCustomerServiceStatus).not.toHaveBeenCalled();
  });
});