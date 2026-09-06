import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelAutomationJob: vi.fn(),
  findCustomerById: vi.fn(),
  updateCustomerServiceStatus: vi.fn(),
  findLatestInboundWhatsAppMessage: vi.fn(),
  saveWhatsAppMessage: vi.fn(),
  sendTextMessage: vi.fn(),
}));

vi.mock("../automation/queue", () => ({ cancelAutomationJob: mocks.cancelAutomationJob }));
vi.mock("../crm", () => ({
  findCustomerById: mocks.findCustomerById,
  updateCustomerServiceStatus: mocks.updateCustomerServiceStatus,
}));
vi.mock("./client", () => ({ sendTextMessage: mocks.sendTextMessage }));
vi.mock("./messages", () => ({
  findLatestInboundWhatsAppMessage: mocks.findLatestInboundWhatsAppMessage,
  saveWhatsAppMessage: mocks.saveWhatsAppMessage,
}));

import { sendManualCustomerMessage } from "./manual-messages";

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
});