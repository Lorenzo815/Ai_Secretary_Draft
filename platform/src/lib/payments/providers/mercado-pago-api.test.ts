import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const { getMercadoPagoCredential } = vi.hoisted(() => ({ getMercadoPagoCredential: vi.fn() }));
vi.mock("../provider-credentials", () => ({ getMercadoPagoCredential }));

import { cancelCharge, createPaymentLink, createPixCharge, findPaymentsByReference, getOrder, getPayment } from "./mercado-pago";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Mercado Pago adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getMercadoPagoCredential.mockResolvedValue({ accessToken: "APP_USR-test-token", webhookSecret: "test-secret", source: "database" });
  });

  it("creates a Pix order with expiry, idempotency key and external reference", async () => {
    const paymentRequestId = new ObjectId();
    const fetchMock = vi.fn().mockResolvedValue(json({
      id: "ORD01ABC", status: "action_required",
      transactions: { payments: [{ id: "PAY01", date_of_expiration: "2026-11-03T04:00:00.000+00:00",
        payment_method: { id: "pix", qr_code: "000201-pix", qr_code_base64: "", ticket_url: "https://mp.test/pix" } }] },
    }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createPixCharge({
      paymentRequestId, amountCents: 10_000, payerEmail: "payer@example.com", payerFirstName: "Lorenzo Puppi",
      description: "Sinal", expiryMinutes: 30,
    })).resolves.toEqual({
      orderId: "ORD01ABC", status: "action_required", qrCode: "000201-pix", qrCodeBase64: undefined,
      ticketUrl: "https://mp.test/pix", expiresAt: new Date("2026-11-03T04:00:00.000Z"),
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mercadopago.com/v1/orders");
    expect(request.headers["X-Idempotency-Key"]).toBe(paymentRequestId.toHexString());
    expect(JSON.parse(request.body)).toEqual({
      type: "online", processing_mode: "automatic", external_reference: paymentRequestId.toHexString(),
      total_amount: "100.00", description: "Sinal", payer: { email: "payer@example.com", first_name: "Lorenzo" },
      transactions: { payments: [{ amount: "100.00", payment_method: { id: "pix", type: "bank_transfer" }, expiration_time: "PT30M" }] },
    });
  });

  it("creates a payment link offering only the clinic's methods, with installments and expiry", async () => {
    const paymentRequestId = new ObjectId();
    const expiresAt = new Date("2026-11-04T12:00:00.000Z");
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "PREF-1", init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF-1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createPaymentLink({
      paymentRequestId, amountCents: 10_000, payerEmail: "payer@example.com", description: "Sinal",
      methods: ["credit_card", "ticket"], maxInstallments: 3, expiresAt, notificationUrl: "https://oria.test/api/webhooks/mercado-pago?company=abc",
    })).resolves.toEqual({ preferenceId: "PREF-1", url: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=PREF-1", expiresAt });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mercadopago.com/checkout/preferences");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      external_reference: paymentRequestId.toHexString(),
      items: [{ quantity: 1, unit_price: 100, currency_id: "BRL" }],
      payer: { email: "payer@example.com" },
      payment_methods: { installments: 3 },
      expires: true, expiration_date_to: expiresAt.toISOString(),
      notification_url: "https://oria.test/api/webhooks/mercado-pago?company=abc",
    });
    expect(body.payment_methods.excluded_payment_types.map((type: { id: string }) => type.id))
      .toEqual(expect.arrayContaining(["debit_card", "bank_transfer"]));
    expect(body.payment_methods.excluded_payment_types.map((type: { id: string }) => type.id))
      .not.toEqual(expect.arrayContaining(["credit_card"]));
  });

  it("reads an order and a payment with fees and net amount", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({
        id: "ORD01ABC", status: "processed", status_detail: "accredited", external_reference: "ref", total_amount: "100.00", country_code: "BRA",
        currency: "BRL", last_updated_date: "2026-11-03T04:20:59.839Z",
        transactions: { payments: [{ id: "PAY01", amount: "100.00", paid_amount: "100.00", status: "processed", status_detail: "accredited", payment_method: { id: "pix", type: "bank_transfer" } }] },
      }))
      .mockResolvedValueOnce(json({
        id: 123, status: "approved", status_detail: "accredited", external_reference: "ref", transaction_amount: 100, currency_id: "BRL",
        payment_type_id: "credit_card", payment_method_id: "visa", installments: 3, date_approved: "2026-11-03T03:00:00Z",
        live_mode: false, payer: { email: "payer@example.com" }, fee_details: [{ amount: 4.98 }],
        transaction_details: { total_paid_amount: 100, net_received_amount: 95.02 },
      })));
    await expect(getOrder("ORD01ABC")).resolves.toEqual({
      orderId: "ORD01ABC", externalReference: "ref", amountCents: 10_000, currency: "BRL", status: "processed", statusDetail: "accredited",
      payments: [expect.objectContaining({
        paymentId: "PAY01", externalReference: "ref", amountCents: 10_000, paidAmountCents: 10_000, currency: "BRL",
        status: "approved", statusDetail: "accredited", paymentType: "bank_transfer", paymentMethod: "pix",
        approvedAt: new Date("2026-11-03T04:20:59.839Z"),
      })],
    });
    await expect(getPayment("123")).resolves.toMatchObject({
      paymentId: "123", status: "approved", amountCents: 10_000, paidAmountCents: 10_000, netReceivedCents: 9_502, feeCents: 498,
      paymentType: "credit_card", paymentMethod: "visa", installments: 3, approvedAt: new Date("2026-11-03T03:00:00Z"), liveMode: false,
    });
  });

  it("finds every attempt recorded for one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ results: [
      { id: 1, status: "rejected", external_reference: "ref", transaction_amount: 100 },
      { id: 2, status: "approved", external_reference: "ref", transaction_amount: 100 },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const payments = await findPaymentsByReference("ref");
    expect(payments.map((payment) => [payment.paymentId, payment.status])).toEqual([["1", "rejected"], ["2", "approved"]]);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/payments/search?external_reference=ref");
  });

  it("reports Mercado Pago's reason when a charge is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      message: "Unauthorized use of live credentials", cause: [{ code: 7, description: "Unauthorized use of live credentials" }],
    }, 401)));
    await expect(createPixCharge({
      paymentRequestId: new ObjectId(), amountCents: 100, payerEmail: "payer@example.com", description: "Sinal", expiryMinutes: 60,
    })).rejects.toThrow("Mercado Pago HTTP 401: Unauthorized use of live credentials (7 Unauthorized use of live credentials)");
  });

  it("refuses an order without a Pix code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: "ORD01ABC", status: "action_required", transactions: { payments: [{}] } }, 201)));
    await expect(createPixCharge({
      paymentRequestId: new ObjectId(), amountCents: 100, payerEmail: "payer@example.com", description: "Sinal", expiryMinutes: 60,
    })).rejects.toThrow("Pix válido");
  });

  it("cancels an outdated charge on a best-effort basis", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 200)).mockResolvedValueOnce(json({ message: "no" }, 422));
    vi.stubGlobal("fetch", fetchMock);
    await expect(cancelCharge({ method: "payment_link", externalId: "PREF-1" })).resolves.toBe(true);
    await expect(cancelCharge({ method: "pix", externalId: "ORD01" })).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.mercadopago.com/v1/orders/ORD01/cancel");
  });
});
