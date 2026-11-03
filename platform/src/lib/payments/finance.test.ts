import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachPaymentToAppointments: vi.fn(),
  detachPaymentFromAppointments: vi.fn(),
  findAppointmentsByIds: vi.fn(),
  getCalendarSettings: vi.fn(),
  listAllocatableAppointments: vi.fn(),
  getPaymentRequest: vi.fn(),
  setPaymentAppointments: vi.fn(),
  unlinkAppointmentsFromOtherPayments: vi.fn(),
  createManualPaymentEntry: vi.fn(),
  deleteManualPaymentEntry: vi.fn(),
  recordManualEntryRemoval: vi.fn(),
  listPaymentRequests: vi.fn(),
  listTransactionsForRequests: vi.fn(),
  customersFindOne: vi.fn(),
  customersToArray: vi.fn(),
}));

vi.mock("../calendar", () => ({
  attachPaymentToAppointments: mocks.attachPaymentToAppointments,
  detachPaymentFromAppointments: mocks.detachPaymentFromAppointments,
  findAppointmentsByIds: mocks.findAppointmentsByIds,
  getCalendarSettings: mocks.getCalendarSettings,
  listAllocatableAppointments: mocks.listAllocatableAppointments,
}));
vi.mock("./payments", () => ({
  createManualPaymentEntry: mocks.createManualPaymentEntry,
  deleteManualPaymentEntry: mocks.deleteManualPaymentEntry,
  getPaymentRequest: mocks.getPaymentRequest,
  listPaymentRequests: mocks.listPaymentRequests,
  setPaymentAppointments: mocks.setPaymentAppointments,
  unlinkAppointmentsFromOtherPayments: mocks.unlinkAppointmentsFromOtherPayments,
}));
vi.mock("./ledger", () => ({
  listTransactionsForRequests: mocks.listTransactionsForRequests,
  recordManualEntryRemoval: mocks.recordManualEntryRemoval,
}));
vi.mock("../companies/tenant-db", () => ({
  tenantDb: async () => ({
    collection: () => ({
      findOne: mocks.customersFindOne,
      find: () => ({ toArray: mocks.customersToArray }),
    }),
  }),
}));
vi.mock("../confirmations/service", () => ({ applyAttendanceAfterPayment: vi.fn(async () => "pending"), getOpenConfirmationForCustomer: vi.fn(async () => null), handleConfirmationButton: vi.fn(async () => ({ handled: false })), processAppointmentConfirmations: vi.fn(async () => ({ skipped: true })) }));

import { allocatePayment, FinanceError, listFinance, registerManualPayment, removeManualPayment } from "./finance";

describe("Financeiro", () => {
  const customerId = new ObjectId();
  const soon = new Date(Date.now() + 3_600_000);
  const appointment = (patch: Record<string, unknown> = {}) => ({
    _id: new ObjectId(), customerId, status: "scheduled", eventType: "consultation", startAt: soon, ...patch,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCalendarSettings.mockResolvedValue({ timezone: "America/Sao_Paulo", eventTypes: [{ key: "consultation", name: "Consulta" }] });
    mocks.listTransactionsForRequests.mockResolvedValue(new Map());
    mocks.customersToArray.mockResolvedValue([{ _id: customerId, name: "Ana" }]);
    mocks.customersFindOne.mockResolvedValue({ _id: customerId });
  });

  describe("linking a payment to appointments", () => {
    it("links new appointments, unlinks removed ones and takes them from other payments", async () => {
      const kept = appointment();
      const removed = new ObjectId();
      const added = appointment({ status: "held", holdExpiresAt: soon });
      const payment = { _id: new ObjectId(), customerId, status: "paid", appointmentIds: [kept._id, removed], paidAt: new Date("2026-10-01T12:00:00Z") };
      mocks.getPaymentRequest.mockResolvedValue(payment);
      mocks.findAppointmentsByIds.mockResolvedValue([kept, added]);

      await allocatePayment({ paymentRequestId: payment._id, appointmentIds: [kept._id, added._id, added._id] });

      expect(mocks.detachPaymentFromAppointments).toHaveBeenCalledWith(payment._id, [removed]);
      expect(mocks.unlinkAppointmentsFromOtherPayments).toHaveBeenCalledWith([kept._id, added._id], payment._id);
      expect(mocks.attachPaymentToAppointments).toHaveBeenCalledWith({
        customerId, appointmentIds: [kept._id, added._id], paymentRequestId: payment._id, paidAt: payment.paidAt,
      });
      expect(mocks.setPaymentAppointments).toHaveBeenCalledWith(payment._id, [kept._id, added._id]);
    });

    it("only links received payments", async () => {
      mocks.getPaymentRequest.mockResolvedValue({ _id: new ObjectId(), customerId, status: "awaiting_human_confirmation" });

      await expect(allocatePayment({ paymentRequestId: new ObjectId(), appointmentIds: [] })).rejects.toThrow(/recebidos/);
      expect(mocks.attachPaymentToAppointments).not.toHaveBeenCalled();
    });

    it.each([
      ["another patient's appointment", { customerId: new ObjectId() }],
      ["a cancelled appointment", { status: "cancelled" }],
      ["an expired hold", { status: "held", holdExpiresAt: new Date(Date.now() - 1_000) }],
    ])("refuses %s", async (_label, patch) => {
      const target = appointment(patch);
      mocks.getPaymentRequest.mockResolvedValue({ _id: new ObjectId(), customerId, status: "paid", appointmentIds: [] });
      mocks.findAppointmentsByIds.mockResolvedValue([target]);

      await expect(allocatePayment({ paymentRequestId: new ObjectId(), appointmentIds: [target._id] })).rejects.toBeInstanceOf(FinanceError);
      expect(mocks.attachPaymentToAppointments).not.toHaveBeenCalled();
    });
  });

  it("registers a payment received outside the system and links it", async () => {
    const target = appointment({ status: "held", holdExpiresAt: soon });
    mocks.findAppointmentsByIds.mockResolvedValue([target]);
    const created = { _id: new ObjectId() };
    mocks.createManualPaymentEntry.mockResolvedValue(created);
    const receivedAt = new Date("2026-10-01T12:00:00Z");

    await registerManualPayment({
      customerId, amountCents: 50_000, method: "card_machine", receivedAt, appointmentIds: [target._id], createdBy: "staff@clinic",
    });

    expect(mocks.createManualPaymentEntry).toHaveBeenCalledWith(expect.objectContaining({ customerId, amountCents: 50_000, method: "card_machine", appointmentIds: [target._id] }));
    expect(mocks.attachPaymentToAppointments).toHaveBeenCalledWith({ customerId, appointmentIds: [target._id], paymentRequestId: created._id, paidAt: receivedAt });
  });

  describe("removing a payment", () => {
    it("removes a payment registered by staff, unlinks its appointments and records the reversal", async () => {
      const entry = { _id: new ObjectId(), customerId, provider: "manual", manualMethod: "cash", status: "paid", amountCents: 5_000 };
      mocks.getPaymentRequest.mockResolvedValue(entry);
      mocks.deleteManualPaymentEntry.mockResolvedValue(entry);

      await removeManualPayment({ paymentRequestId: entry._id, removedBy: "staff@clinic", reason: "duplicado" });

      expect(mocks.detachPaymentFromAppointments).toHaveBeenCalledWith(entry._id);
      expect(mocks.deleteManualPaymentEntry).toHaveBeenCalledWith(entry._id);
      expect(mocks.recordManualEntryRemoval).toHaveBeenCalledWith({
        paymentRequestId: entry._id, customerId, amountCents: 5_000, method: "cash", removedBy: "staff@clinic", reason: "duplicado",
      });
    });

    it.each([
      ["a Mercado Pago deposit", { provider: "mercado_pago", channel: "pix" }],
      ["a Pix deposit checked by staff", { provider: "manual" }],
    ])("refuses to remove %s", async (_label, patch) => {
      mocks.getPaymentRequest.mockResolvedValue({ _id: new ObjectId(), customerId, status: "paid", amountCents: 10_000, ...patch });

      await expect(removeManualPayment({ paymentRequestId: new ObjectId(), removedBy: "staff@clinic" })).rejects.toThrow(/registrados manualmente/);
      expect(mocks.detachPaymentFromAppointments).not.toHaveBeenCalled();
      expect(mocks.deleteManualPaymentEntry).not.toHaveBeenCalled();
    });
  });

  it("refuses an unknown manual method", async () => {
    await expect(registerManualPayment({
      customerId, amountCents: 100, method: "crypto", receivedAt: new Date(), appointmentIds: [], createdBy: "staff@clinic",
    })).rejects.toThrow(/Forma de pagamento/);
  });

  it("totals received money, Mercado Pago fees and payments without appointments; refunds don't count", async () => {
    const paidWithFee = { _id: new ObjectId(), customerId, provider: "mercado_pago", channel: "pix", providerPaymentId: "123", status: "paid", amountCents: 10_000, appointmentIds: [], createdAt: new Date(), paidAt: new Date() };
    const refunded = { ...paidWithFee, _id: new ObjectId(), refundedAt: new Date(), refundStatus: "refunded" };
    const manual = { _id: new ObjectId(), customerId, provider: "manual", manualMethod: "cash", status: "paid", amountCents: 5_000, appointmentIds: [], createdAt: new Date(), paidAt: new Date() };
    mocks.listPaymentRequests.mockResolvedValue([paidWithFee, refunded, manual]);
    mocks.findAppointmentsByIds.mockResolvedValue([]);
    mocks.listTransactionsForRequests.mockResolvedValue(new Map([[paidWithFee._id.toHexString(), [{ status: "approved", providerPaymentId: "123", feeCents: 99, paymentMethod: "pix" }]]]));

    const result = await listFinance({ view: "processed" });

    expect(result.totals).toEqual({ count: 2, receivedCents: 15_000, feesCents: 99, netCents: 14_901, refundedCents: 10_000, unallocatedCount: 2 });
    expect(result.payments.map((payment) => payment.methodLabel)).toEqual(["Pix Mercado Pago", "Pix Mercado Pago", "Dinheiro"]);
    expect(result.payments[0]).toMatchObject({ customerName: "Ana", feeCents: 99, netCents: 9_901 });
  });
});
