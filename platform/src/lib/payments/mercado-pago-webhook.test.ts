import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  applyProviderPaymentStatus: vi.fn(),
  completePaymentTransition: vi.fn(),
  findPaymentRequestById: vi.fn(),
  getMercadoPagoCredential: vi.fn(),
  getOrder: vi.fn(),
  getPayment: vi.fn(),
  findPaymentsByReference: vi.fn(),
  recordMercadoPagoPayment: vi.fn(),
  markPaymentRefunded: vi.fn(),
  verifySignature: vi.fn(),
}));

vi.mock("./completion", () => ({ completePaymentTransition: mocks.completePaymentTransition }));
vi.mock("./ledger", () => ({ recordMercadoPagoPayment: mocks.recordMercadoPagoPayment }));
vi.mock("./payments", () => ({
  applyProviderPaymentStatus: mocks.applyProviderPaymentStatus,
  findPaymentRequestById: mocks.findPaymentRequestById,
  markPaymentRefunded: mocks.markPaymentRefunded,
}));
vi.mock("./provider-credentials", () => ({ getMercadoPagoCredential: mocks.getMercadoPagoCredential }));
vi.mock("./providers/mercado-pago", () => ({
  getOrder: mocks.getOrder, getPayment: mocks.getPayment, findPaymentsByReference: mocks.findPaymentsByReference,
}));
vi.mock("./providers/mercado-pago-signature", () => ({ verifyMercadoPagoWebhookSignature: mocks.verifySignature }));

import { processMercadoPagoWebhook } from "./mercado-pago-webhook";

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "111", externalReference: "", amountCents: 10_000, paidAmountCents: 10_000, netReceivedCents: 9_500, feeCents: 500,
    currency: "BRL", status: "approved", statusDetail: "accredited", paymentType: "bank_transfer", paymentMethod: "pix",
    installments: 1, payerEmail: "payer@example.com", createdAt: new Date(), approvedAt: new Date(), liveMode: false, ...overrides,
  };
}

describe("Mercado Pago webhook processing", () => {
  const paymentRequestId = new ObjectId();
  const reference = paymentRequestId.toHexString();
  const pixRequest = {
    _id: paymentRequestId, customerId: new ObjectId(), amountCents: 10_000, provider: "mercado_pago", channel: "pix",
    externalPaymentId: "ORD01ABC", status: "awaiting_provider_confirmation",
  };
  const order = (status: string) => ({ orderId: "ORD01ABC", externalReference: reference, amountCents: 10_000, currency: "BRL", status, statusDetail: "" });
  const notify = (topic: "order" | "payment", dataId: string) =>
    processMercadoPagoWebhook({ topic, dataId, signature: "signature", requestId: "request" });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMercadoPagoCredential.mockResolvedValue({ accessToken: "token", webhookSecret: "secret" });
    mocks.verifySignature.mockReturnValue(true);
    mocks.getOrder.mockResolvedValue(order("processed"));
    mocks.findPaymentsByReference.mockResolvedValue([attempt({ externalReference: reference })]);
    mocks.findPaymentRequestById.mockResolvedValue(pixRequest);
    mocks.applyProviderPaymentStatus.mockImplementation(async (input) => ({ ...pixRequest, status: input.status }));
    mocks.completePaymentTransition.mockResolvedValue({});
  });

  it("marks a paid deposit as refunded so it no longer counts as a previous deposit, keeping the booking", async () => {
    mocks.findPaymentRequestById.mockResolvedValue({ ...pixRequest, status: "paid", providerPaymentId: "111" });
    mocks.getPayment.mockResolvedValue(attempt({ externalReference: reference, status: "refunded" }));
    mocks.findPaymentsByReference.mockResolvedValue([attempt({ externalReference: reference, status: "refunded" })]);

    await expect(notify("payment", "111")).resolves.toMatchObject({ processed: false, status: "refunded" });
    expect(mocks.markPaymentRefunded).toHaveBeenCalledWith(paymentRequestId, "refunded");
    expect(mocks.recordMercadoPagoPayment).toHaveBeenCalledWith(expect.objectContaining({ payment: expect.objectContaining({ status: "refunded" }) }));
    expect(mocks.completePaymentTransition).not.toHaveBeenCalled();
  });

  it("rejects notifications with an invalid signature before reading anything", async () => {
    mocks.verifySignature.mockReturnValue(false);
    await expect(notify("order", "ORD01ABC")).rejects.toMatchObject({ status: 401 });
    expect(mocks.getOrder).not.toHaveBeenCalled();
  });

  it("records the payment in the ledger and completes the request when the Pix order is processed", async () => {
    await expect(notify("order", "ORD01ABC")).resolves.toMatchObject({ processed: true, status: "processed", recorded: 1 });
    expect(mocks.recordMercadoPagoPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentRequestId, channel: "pix" }));
    expect(mocks.applyProviderPaymentStatus).toHaveBeenCalledWith({
      paymentRequestId, status: "paid", providerStatus: "approved", providerPaymentId: "111",
    });
    expect(mocks.completePaymentTransition).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }), "paid");
  });

  it("does not repeat completion when another notification already settled the request", async () => {
    mocks.applyProviderPaymentStatus.mockResolvedValue(null);
    await expect(notify("order", "ORD01ABC")).resolves.toMatchObject({ processed: false });
    expect(mocks.recordMercadoPagoPayment).toHaveBeenCalledOnce();
    expect(mocks.completePaymentTransition).not.toHaveBeenCalled();
  });

  it("rejects an order that doesn't match the request, without recording anything", async () => {
    mocks.getOrder.mockResolvedValue({ ...order("processed"), amountCents: 9_900 });
    await expect(notify("order", "ORD01ABC")).rejects.toThrow("não conferem");
    expect(mocks.recordMercadoPagoPayment).not.toHaveBeenCalled();
    expect(mocks.applyProviderPaymentStatus).not.toHaveBeenCalled();
  });

  it("ends a Pix request when its order is canceled or expired", async () => {
    mocks.getOrder.mockResolvedValue(order("expired"));
    mocks.findPaymentsByReference.mockResolvedValue([]);
    await notify("order", "ORD01ABC");
    expect(mocks.applyProviderPaymentStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", providerStatus: "expired" }));
  });

  it("keeps waiting while the Pix order awaits the transfer", async () => {
    mocks.getOrder.mockResolvedValue(order("action_required"));
    mocks.findPaymentsByReference.mockResolvedValue([]);
    await expect(notify("order", "ORD01ABC")).resolves.toMatchObject({ processed: false, status: "action_required" });
    expect(mocks.applyProviderPaymentStatus).not.toHaveBeenCalled();
  });

  describe("payment link (payment notifications)", () => {
    const linkRequest = { ...pixRequest, channel: "payment_link", externalPaymentId: "PREF-1" };
    beforeEach(() => mocks.findPaymentRequestById.mockResolvedValue(linkRequest));

    it("records a rejected card attempt but keeps the request open for another try", async () => {
      const rejected = attempt({ paymentId: "222", status: "rejected", statusDetail: "cc_rejected_insufficient_amount", paymentType: "credit_card", externalReference: reference });
      mocks.getPayment.mockResolvedValue(rejected);
      mocks.findPaymentsByReference.mockResolvedValue([rejected]);
      await expect(notify("payment", "222")).resolves.toMatchObject({ processed: false, status: "rejected" });
      expect(mocks.recordMercadoPagoPayment).toHaveBeenCalledWith(expect.objectContaining({ channel: "payment_link", payment: rejected }));
      expect(mocks.applyProviderPaymentStatus).not.toHaveBeenCalled();
    });

    it("completes the request when a later attempt is approved, recording every attempt once", async () => {
      const rejected = attempt({ paymentId: "222", status: "rejected", paymentType: "credit_card", externalReference: reference });
      const approved = attempt({ paymentId: "333", status: "approved", paymentType: "credit_card", installments: 3, externalReference: reference });
      mocks.getPayment.mockResolvedValue(approved);
      mocks.findPaymentsByReference.mockResolvedValue([rejected, approved]);
      await expect(notify("payment", "333")).resolves.toMatchObject({ processed: true, recorded: 2 });
      expect(mocks.applyProviderPaymentStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", providerPaymentId: "333" }));
    });

    it("still records a payment Mercado Pago's search hasn't indexed yet", async () => {
      const approved = attempt({ paymentId: "444", externalReference: reference });
      mocks.getPayment.mockResolvedValue(approved);
      mocks.findPaymentsByReference.mockResolvedValue([]);
      await expect(notify("payment", "444")).resolves.toMatchObject({ processed: true, recorded: 1 });
    });

    it("refuses an approved payment of another amount", async () => {
      const wrong = attempt({ paymentId: "555", amountCents: 1_000, externalReference: reference });
      mocks.getPayment.mockResolvedValue(wrong);
      mocks.findPaymentsByReference.mockResolvedValue([wrong]);
      await expect(notify("payment", "555")).rejects.toThrow("não conferem");
      expect(mocks.applyProviderPaymentStatus).not.toHaveBeenCalled();
    });
  });

  it("ignores payments that aren't ours", async () => {
    mocks.getPayment.mockResolvedValue(attempt({ externalReference: "someone-else" }));
    mocks.findPaymentRequestById.mockResolvedValue(null);
    await expect(notify("payment", "999")).rejects.toMatchObject({ status: 404 });
    expect(mocks.recordMercadoPagoPayment).not.toHaveBeenCalled();
  });
});
