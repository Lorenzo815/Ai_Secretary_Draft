import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  applyProviderPaymentStatus: vi.fn(),
  completePaymentTransition: vi.fn(),
  findPaymentRequestById: vi.fn(),
  getMercadoPagoCredential: vi.fn(),
  getPayment: vi.fn(),
  verifySignature: vi.fn(),
}));

vi.mock("./completion", () => ({ completePaymentTransition: mocks.completePaymentTransition }));
vi.mock("./payments", () => ({
  applyProviderPaymentStatus: mocks.applyProviderPaymentStatus,
  findPaymentRequestById: mocks.findPaymentRequestById,
}));
vi.mock("./provider-credentials", () => ({ getMercadoPagoCredential: mocks.getMercadoPagoCredential }));
vi.mock("./providers/mercado-pago", () => ({ mercadoPagoProvider: { getPayment: mocks.getPayment } }));
vi.mock("./providers/mercado-pago-signature", () => ({ verifyMercadoPagoWebhookSignature: mocks.verifySignature }));

import { processMercadoPagoWebhook } from "./mercado-pago-webhook";

describe("Mercado Pago webhook processing", () => {
  const paymentRequestId = new ObjectId();
  const payment = {
    _id: paymentRequestId,
    customerId: new ObjectId(),
    amountCents: 10_000,
    provider: "mercado_pago",
    externalPaymentId: "ORD01ABC",
    status: "awaiting_provider_confirmation",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMercadoPagoCredential.mockResolvedValue({ accessToken: "token", webhookSecret: "secret" });
    mocks.verifySignature.mockReturnValue(true);
    mocks.getPayment.mockResolvedValue({
      externalPaymentId: "ORD01ABC",
      externalReference: paymentRequestId.toHexString(),
      amountCents: 10_000,
      currency: "BRL",
      status: "processed",
    });
    mocks.findPaymentRequestById.mockResolvedValue(payment);
    mocks.applyProviderPaymentStatus.mockResolvedValue({ ...payment, status: "paid" });
    mocks.completePaymentTransition.mockResolvedValue({});
  });

  it("resumes the shared workflow after an authoritative approval", async () => {
    await expect(processMercadoPagoWebhook({ dataId: "ORD01ABC", signature: "signature", requestId: "request" }))
      .resolves.toEqual({ processed: true, status: "processed" });
    expect(mocks.applyProviderPaymentStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }));
    expect(mocks.completePaymentTransition).toHaveBeenCalledOnce();
  });

  it("does not repeat completion when the atomic transition already happened", async () => {
    mocks.applyProviderPaymentStatus.mockResolvedValue(null);
    await expect(processMercadoPagoWebhook({ dataId: "ORD01ABC", signature: "signature", requestId: "request" }))
      .resolves.toEqual({ processed: false, status: "processed" });
    expect(mocks.completePaymentTransition).not.toHaveBeenCalled();
  });

  it("rejects mismatched amount before changing local state", async () => {
    mocks.getPayment.mockResolvedValue({
      externalPaymentId: "ORD01ABC",
      externalReference: paymentRequestId.toHexString(),
      amountCents: 9_900,
      currency: "BRL",
      status: "processed",
    });
    await expect(processMercadoPagoWebhook({ dataId: "ORD01ABC", signature: "signature", requestId: "request" }))
      .rejects.toThrow("não conferem");
    expect(mocks.applyProviderPaymentStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["action_required", null], ["processing", null], ["created", null],
    ["canceled", "rejected"], ["failed", "rejected"], ["refunded", "rejected"], ["charged_back", "rejected"],
  ])("maps order status %s to %s", async (status, expected) => {
    mocks.getPayment.mockResolvedValue({
      externalPaymentId: "ORD01ABC", externalReference: paymentRequestId.toHexString(), amountCents: 10_000, currency: "BRL", status,
    });
    await processMercadoPagoWebhook({ dataId: "ORD01ABC", signature: "signature", requestId: "request" });
    if (expected) expect(mocks.applyProviderPaymentStatus).toHaveBeenCalledWith(expect.objectContaining({ status: expected }));
    else expect(mocks.applyProviderPaymentStatus).not.toHaveBeenCalled();
  });
});