import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const { getMercadoPagoCredential } = vi.hoisted(() => ({ getMercadoPagoCredential: vi.fn() }));
vi.mock("../provider-credentials", () => ({ getMercadoPagoCredential }));

import { mercadoPagoProvider } from "./mercado-pago";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Mercado Pago Pix adapter (Orders API)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getMercadoPagoCredential.mockResolvedValue({ accessToken: "APP_USR-test-token", webhookSecret: "test-secret", source: "database" });
  });

  it("creates a Pix order with the local request id as idempotency key and external reference", async () => {
    const paymentRequestId = new ObjectId();
    const fetchMock = vi.fn().mockResolvedValue(json({
      id: "ORD01ABC", status: "action_required",
      transactions: { payments: [{ id: "PAY01", payment_method: { id: "pix", qr_code: "000201-pix", qr_code_base64: "", ticket_url: "https://mp.test/pix" } }] },
    }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mercadoPagoProvider.createPayment({
      paymentRequestId, amountCents: 10_000, payerEmail: "payer@example.com", payerFirstName: "Lorenzo Puppi", description: "Sinal",
    })).resolves.toEqual({ externalPaymentId: "ORD01ABC", status: "action_required", qrCode: "000201-pix", qrCodeBase64: undefined, ticketUrl: "https://mp.test/pix" });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mercadopago.com/v1/orders");
    expect(request.headers["X-Idempotency-Key"]).toBe(paymentRequestId.toHexString());
    expect(JSON.parse(request.body)).toEqual({
      type: "online", processing_mode: "automatic", external_reference: paymentRequestId.toHexString(),
      total_amount: "100.00", description: "Sinal", payer: { email: "payer@example.com", first_name: "Lorenzo" },
      transactions: { payments: [{ amount: "100.00", payment_method: { id: "pix", type: "bank_transfer" } }] },
    });
  });

  it("reads an order back with amount, reference and currency", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      id: "ORD01ABC", status: "processed", external_reference: "ref", total_amount: "100.00", country_code: "BRA",
    })));
    await expect(mercadoPagoProvider.getPayment("ORD01ABC")).resolves.toEqual({
      externalPaymentId: "ORD01ABC", externalReference: "ref", amountCents: 10_000, currency: "BRL", status: "processed",
    });
  });

  it("reports Mercado Pago's reason when the order is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      message: "Unauthorized use of live credentials", cause: [{ code: 7, description: "Unauthorized use of live credentials" }],
    }, 401)));
    await expect(mercadoPagoProvider.createPayment({
      paymentRequestId: new ObjectId(), amountCents: 100, payerEmail: "payer@example.com", description: "Sinal",
    })).rejects.toThrow("Mercado Pago HTTP 401: Unauthorized use of live credentials (7 Unauthorized use of live credentials)");
  });

  it("refuses an order without a Pix code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: "ORD01ABC", status: "action_required", transactions: { payments: [{}] } }, 201)));
    await expect(mercadoPagoProvider.createPayment({
      paymentRequestId: new ObjectId(), amountCents: 100, payerEmail: "payer@example.com", description: "Sinal",
    })).rejects.toThrow("Pix válido");
  });
});
