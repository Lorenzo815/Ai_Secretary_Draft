import "server-only";

import { getMercadoPagoCredential } from "../provider-credentials";
import type { PaymentProviderAdapter } from "./types";

// Checkout API via Orders (/v1/orders), the current Mercado Pago API for Pix. Unlike /v1/payments it also accepts
// test credentials (sandbox). In sandbox, a payer first name of "APRO" makes Mercado Pago approve the Pix by itself.
const API_URL = "https://api.mercadopago.com";

export const mercadoPagoProvider: PaymentProviderAdapter = {
  async createPayment(input) {
    const credential = await requireCredential();
    const amount = (input.amountCents / 100).toFixed(2);
    const firstName = input.payerFirstName?.trim().split(/\s+/)[0]?.slice(0, 60);
    const response = await fetch(`${API_URL}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": input.paymentRequestId.toHexString(),
      },
      body: JSON.stringify({
        type: "online",
        processing_mode: "automatic",
        external_reference: input.paymentRequestId.toHexString(),
        total_amount: amount,
        description: input.description,
        payer: { email: input.payerEmail, ...(firstName ? { first_name: firstName } : {}) },
        transactions: { payments: [{ amount, payment_method: { id: "pix", type: "bank_transfer" } }] },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const order = await readOrderResponse(response);
    const pix = order.transactions?.payments?.[0]?.payment_method;
    if (!order.id || !pix?.qr_code) throw new Error("O Mercado Pago não retornou um Pix válido.");
    return {
      externalPaymentId: order.id,
      status: order.status ?? "action_required",
      qrCode: pix.qr_code,
      qrCodeBase64: pix.qr_code_base64 || undefined,
      ticketUrl: pix.ticket_url,
    };
  },
  async getPayment(orderId) {
    const credential = await requireCredential();
    const response = await fetch(`${API_URL}/v1/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const order = await readOrderResponse(response);
    return {
      externalPaymentId: order.id ?? orderId,
      externalReference: order.external_reference ?? "",
      amountCents: Math.round(Number(order.total_amount) * 100),
      // Orders carry the country rather than always a currency; Brazilian orders are always in reais.
      currency: order.currency_id ?? (order.country_code === "BRA" ? "BRL" : ""),
      status: order.status ?? "",
    };
  },
};

export async function checkMercadoPagoAccount() {
  const credential = await requireCredential();
  const startedAt = Date.now();
  const response = await fetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${credential.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const account = await response.json() as { id?: number; nickname?: string; site_id?: string; message?: string; tags?: string[] };
  if (!response.ok || !account.id) throw new Error(account.message || "O Mercado Pago recusou a credencial.");
  return {
    accountId: String(account.id),
    nickname: account.nickname ?? "Conta Mercado Pago",
    siteId: account.site_id ?? "MLB",
    testAccount: Array.isArray(account.tags) && account.tags.includes("test_user"),
    durationMs: Date.now() - startedAt,
  };
}

async function requireCredential() {
  const credential = await getMercadoPagoCredential();
  if (!credential) throw new Error("As credenciais do Mercado Pago não estão configuradas.");
  return credential;
}

interface OrderResponse {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string | number;
  currency_id?: string;
  country_code?: string;
  transactions?: { payments?: Array<{ payment_method?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } }> };
  message?: string;
  errors?: Array<{ code?: string; message?: string; details?: string[] }>;
  cause?: Array<{ code?: number | string; description?: string }>;
}

async function readOrderResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as OrderResponse;
  if (!response.ok) {
    const reasons = [
      ...(body.errors ?? []).map((error) => [error.code, error.message, ...(error.details ?? [])].filter(Boolean).join(" ")),
      ...(body.cause ?? []).map((cause) => [cause.code, cause.description].filter(Boolean).join(" ")),
    ].filter(Boolean).join("; ");
    throw new Error(`Mercado Pago HTTP ${response.status}: ${body.message ?? "erro"}${reasons ? ` (${reasons})` : ""}`.slice(0, 300));
  }
  return body;
}
