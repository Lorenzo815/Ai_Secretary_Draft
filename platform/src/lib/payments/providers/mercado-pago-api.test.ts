import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const { getMercadoPagoCredential } = vi.hoisted(() => ({ getMercadoPagoCredential: vi.fn() }));
vi.mock("../provider-credentials", () => ({ getMercadoPagoCredential }));

import { mercadoPagoProvider } from "./mercado-pago";

describe("Mercado Pago Pix adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getMercadoPagoCredential.mockResolvedValue({
      accessToken: "APP_USR-test-token",
      webhookSecret: "test-secret",
      source: "database",
    });
  });

  it("creates Pix with local request id as idempotency key and external reference", async () => {
    const paymentRequestId = new ObjectId();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 987,
      status: "pending",
      point_of_interaction: { transaction_data: { qr_code: "000201-pix", ticket_url: "https://mp.test/pix" } },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mercadoPagoProvider.createPayment({
      paymentRequestId,
      amountCents: 10_000,
      payerEmail: "payer@example.com",
      description: "Sinal",
    })).resolves.toMatchObject({ externalPaymentId: "987", qrCode: "000201-pix" });

    const [, request] = fetchMock.mock.calls[0];
    expect(request.headers["X-Idempotency-Key"]).toBe(paymentRequestId.toHexString());
    expect(JSON.parse(request.body)).toMatchObject({
      transaction_amount: 100,
      payment_method_id: "pix",
      external_reference: paymentRequestId.toHexString(),
      payer: { email: "payer@example.com" },
    });
  });
});