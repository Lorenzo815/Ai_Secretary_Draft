import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const collection = vi.hoisted(() => ({ updateOne: vi.fn(), createIndex: vi.fn(), find: vi.fn() }));
vi.mock("../mongodb", () => ({ default: Promise.resolve({ db: () => ({ collection: () => collection }) }) }));

import { legacyCompanyId } from "../companies/ownership";
import { recordManualReview, recordMercadoPagoPayment } from "./ledger";

describe("payment ledger", () => {
  beforeEach(() => vi.clearAllMocks());

  const payment = {
    paymentId: "123", externalReference: "ref", amountCents: 10_000, paidAmountCents: 10_000, netReceivedCents: 9_502, feeCents: 498,
    currency: "BRL", status: "approved", statusDetail: "accredited", paymentType: "credit_card", paymentMethod: "visa",
    installments: 3, payerEmail: "payer@example.com", createdAt: new Date("2026-11-03T02:59:00Z"), approvedAt: new Date("2026-11-03T03:00:00Z"), liveMode: true,
  };

  it("records a Mercado Pago payment once per status, scoped to the clinic, with fees and net amount", async () => {
    const paymentRequestId = new ObjectId();
    const customerId = new ObjectId();
    await recordMercadoPagoPayment({ paymentRequestId, customerId, channel: "payment_link", payment });

    const [filter, update, options] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ key: "mercado_pago:123:approved", companyId: legacyCompanyId() });
    expect(options).toEqual({ upsert: true });
    expect(update.$setOnInsert).toMatchObject({
      companyId: legacyCompanyId(), paymentRequestId, customerId, provider: "mercado_pago", channel: "payment_link",
      providerPaymentId: "123", status: "approved", amountCents: 10_000, netReceivedCents: 9_502, feeCents: 498,
      installments: 3, occurredAt: payment.approvedAt, source: "mercado_pago_webhook",
    });
    expect(collection.createIndex).toHaveBeenCalledWith({ companyId: 1, key: 1 }, expect.objectContaining({ unique: true }));
  });

  it("adds a new row when the same payment is later refunded", async () => {
    await recordMercadoPagoPayment({ paymentRequestId: new ObjectId(), customerId: new ObjectId(), channel: "pix", payment: { ...payment, status: "refunded" } });
    expect(collection.updateOne.mock.calls[0][0].key).toBe("mercado_pago:123:refunded");
  });

  it("records staff confirmations of manual Pix, including when it is the fallback", async () => {
    const paymentRequestId = new ObjectId();
    await recordManualReview({ paymentRequestId, customerId: new ObjectId(), amountCents: 10_000, status: "approved", reviewedBy: "staff@clinic.test", note: " ok " });
    await recordManualReview({ paymentRequestId, customerId: new ObjectId(), amountCents: 10_000, status: "approved", reviewedBy: "staff@clinic.test", channel: "pix" });

    const [manual, mercadoPagoFallback] = collection.updateOne.mock.calls.map(([, update]) => update.$setOnInsert);
    expect(manual).toMatchObject({
      key: `manual:${paymentRequestId.toHexString()}:approved`, provider: "manual", channel: "manual_pix",
      paidAmountCents: 10_000, source: "staff_review", reviewedBy: "staff@clinic.test", note: "ok",
    });
    expect(mercadoPagoFallback).toMatchObject({ provider: "manual", channel: "pix", source: "staff_review" });
  });
});
