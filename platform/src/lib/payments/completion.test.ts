import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirmHeldSchedulingPlanOptions: vi.fn(),
  emitAutomationEvent: vi.fn(),
  releaseHeldSchedulingPlanOptions: vi.fn(),
  saveWhatsAppMessage: vi.fn(),
  sendTextMessage: vi.fn(),
  updateCustomerServiceStatus: vi.fn(),
}));

vi.mock("../automation", () => ({ emitAutomationEvent: mocks.emitAutomationEvent }));
vi.mock("../calendar/plans", () => ({
  confirmHeldSchedulingPlanOptions: mocks.confirmHeldSchedulingPlanOptions,
  releaseHeldSchedulingPlanOptions: mocks.releaseHeldSchedulingPlanOptions,
}));
vi.mock("../crm", () => ({ updateCustomerServiceStatus: mocks.updateCustomerServiceStatus }));
vi.mock("../whatsapp", () => ({
  saveWhatsAppMessage: mocks.saveWhatsAppMessage,
  sendTextMessage: mocks.sendTextMessage,
}));

import { completePaymentTransition } from "./completion";

describe("payment completion scheduling holds", () => {
  const customerId = new ObjectId();
  const payment = {
    _id: new ObjectId(),
    customerId,
    amountCents: 10_000,
    provider: "manual" as const,
    pixKeySnapshot: "pix",
    recipientNameSnapshot: "Clinic",
    status: "paid" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmHeldSchedulingPlanOptions.mockResolvedValue([]);
    mocks.releaseHeldSchedulingPlanOptions.mockResolvedValue(0);
    mocks.updateCustomerServiceStatus.mockResolvedValue({
      _id: customerId,
      name: "Cliente",
      phones: ["5511999999999"],
    });
    mocks.sendTextMessage.mockResolvedValue({ messageId: "wamid.1" });
  });

  it("promotes an active hold after payment approval", async () => {
    mocks.confirmHeldSchedulingPlanOptions.mockResolvedValue([{ _id: new ObjectId() }]);

    await completePaymentTransition(payment, "paid");

    expect(mocks.confirmHeldSchedulingPlanOptions).toHaveBeenCalledWith(customerId);
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Pagamento confirmado pela equipe. A reserva temporária foi confirmada e o horário escolhido está agendado.",
    }));
    expect(mocks.releaseHeldSchedulingPlanOptions).not.toHaveBeenCalled();
  });

  it("explains that no appointment was confirmed when there is no active hold", async () => {
    await completePaymentTransition(payment, "paid");

    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Pagamento confirmado pela equipe. Como não havia mais uma reserva temporária ativa, nenhum horário foi confirmado automaticamente. Vamos escolher uma nova opção para concluir seu agendamento.",
    }));
  });

  it("uses the provider and plural wording when confirming multiple held appointments", async () => {
    mocks.confirmHeldSchedulingPlanOptions.mockResolvedValue([
      { _id: new ObjectId() },
      { _id: new ObjectId() },
    ]);

    await completePaymentTransition({ ...payment, provider: "mercado_pago" }, "paid");

    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Pagamento confirmado pelo Mercado Pago. A reserva temporária foi confirmada e os horários escolhidos estão agendados.",
    }));
  });

  it("releases active holds after payment rejection", async () => {
    await completePaymentTransition({ ...payment, status: "rejected" }, "rejected");

    expect(mocks.releaseHeldSchedulingPlanOptions).toHaveBeenCalledWith(customerId);
    expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "human_active");
    expect(mocks.confirmHeldSchedulingPlanOptions).not.toHaveBeenCalled();
    expect(mocks.sendTextMessage).not.toHaveBeenCalled();
  });
});
