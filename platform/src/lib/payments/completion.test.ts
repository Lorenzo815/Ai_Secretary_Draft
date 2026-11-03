import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirmHeldSchedulingPlanOptions: vi.fn(),
  emitAutomationEvent: vi.fn(),
  releaseHeldSchedulingPlanOptions: vi.fn(),
  saveWhatsAppMessage: vi.fn(),
  sendTextMessage: vi.fn(),
  updateCustomerServiceStatus: vi.fn(),
  setPaymentAppointments: vi.fn(),
}));

vi.mock("./payments", () => ({ setPaymentAppointments: mocks.setPaymentAppointments }));
vi.mock("../calendar/calendar", () => ({ getCalendarSettings: async () => ({ timezone: "America/Sao_Paulo", eventTypes: [{ key: "consultation", name: "Consulta" }] }) }));

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
vi.mock("../confirmations/service", () => ({ applyAttendanceAfterPayment: vi.fn(async () => "pending"), getOpenConfirmationForCustomer: vi.fn(async () => null), handleConfirmationButton: vi.fn(async () => ({ handled: false })), processAppointmentConfirmations: vi.fn(async () => ({ skipped: true })) }));

import { completePaymentTransition } from "./completion";
import { applyAttendanceAfterPayment } from "../confirmations/service";

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

  it("promotes the held booking the deposit was requested for and records what it covers", async () => {
    const heldIds = [new ObjectId()];
    const paidAt = new Date("2026-10-01T12:00:00Z");
    mocks.confirmHeldSchedulingPlanOptions.mockResolvedValue([{ _id: heldIds[0] }]);

    await completePaymentTransition({ ...payment, appointmentIds: heldIds, paidAt }, "paid");

    expect(mocks.confirmHeldSchedulingPlanOptions).toHaveBeenCalledWith(customerId, { paymentRequestId: payment._id, appointmentIds: heldIds, paidAt });
    expect(mocks.setPaymentAppointments).toHaveBeenCalledWith(payment._id, heldIds);
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Sinal confirmado pela equipe. Seu horário está agendado; vamos confirmar sua presença mais perto da data.",
    }));
    expect(mocks.releaseHeldSchedulingPlanOptions).not.toHaveBeenCalled();
  });

  it("says the time is confirmed when the deposit confirmed attendance directly", async () => {
    const appointment = { _id: new ObjectId(), startAt: new Date("2026-11-06T13:00:00Z"), eventType: "consultation" };
    mocks.confirmHeldSchedulingPlanOptions.mockResolvedValue([appointment]);
    vi.mocked(applyAttendanceAfterPayment).mockResolvedValueOnce("confirmed");

    await completePaymentTransition({ ...payment, provider: "mercado_pago" }, "paid");

    expect(applyAttendanceAfterPayment).toHaveBeenCalledWith({ customerId, appointments: [appointment] });
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Sinal confirmado pelo Mercado Pago. Seu horário está confirmado para sexta-feira, 06/11 às 10:00. Te esperamos!",
    }));
  });

  it("explains that no appointment was confirmed when there is no active hold", async () => {
    await completePaymentTransition(payment, "paid");

    // The deposit stays unallocated: it can confirm the next booking or be linked in Financeiro.
    expect(mocks.setPaymentAppointments).toHaveBeenCalledWith(payment._id, []);

    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Sinal confirmado pela equipe. Como não havia mais uma reserva temporária ativa, nenhum horário foi confirmado automaticamente. Vamos escolher uma nova opção para concluir seu agendamento. Para quando você prefere?",
    }));
  });

  it("uses the provider and plural wording when confirming multiple held appointments", async () => {
    mocks.confirmHeldSchedulingPlanOptions.mockResolvedValue([
      { _id: new ObjectId() },
      { _id: new ObjectId() },
    ]);

    await completePaymentTransition({ ...payment, provider: "mercado_pago" }, "paid");

    expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Sinal confirmado pelo Mercado Pago. Seus horários estão agendados; vamos confirmar sua presença mais perto da data.",
    }));
  });

  it("releases the booking's holds after payment rejection", async () => {
    const schedulingOptionId = new ObjectId();
    await completePaymentTransition({ ...payment, status: "rejected", schedulingOptionId }, "rejected");

    expect(mocks.releaseHeldSchedulingPlanOptions).toHaveBeenCalledWith(customerId, schedulingOptionId);
    expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "human_active");
    expect(mocks.confirmHeldSchedulingPlanOptions).not.toHaveBeenCalled();
    expect(mocks.sendTextMessage).not.toHaveBeenCalled();
  });
});
