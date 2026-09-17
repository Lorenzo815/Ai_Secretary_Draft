import "server-only";

import { getMercadoPagoCredential } from "../provider-credentials";
import type { PaymentProviderAdapter } from "./types";

const API_URL = "https://api.mercadopago.com";

export const mercadoPagoProvider: PaymentProviderAdapter = {
  async createPayment(input) {
    const credential = await requireCredential();
    const response = await fetch(`${API_URL}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": input.paymentRequestId.toHexString(),
      },
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100,
        description: input.description,
        payment_method_id: "pix",
        external_reference: input.paymentRequestId.toHexString(),
        payer: { email: input.payerEmail },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payment = await readPaymentResponse(response);
    const transaction = payment.point_of_interaction?.transaction_data;
    if (!payment.id || !transaction?.qr_code) throw new Error("O Mercado Pago não retornou um Pix válido.");
    return {
      externalPaymentId: String(payment.id),
      status: payment.status ?? "pending",
      qrCode: transaction.qr_code,
      qrCodeBase64: transaction.qr_code_base64,
      ticketUrl: transaction.ticket_url,
    };
  },
  async getPayment(externalPaymentId) {
    const credential = await requireCredential();
    const response = await fetch(`${API_URL}/v1/payments/${encodeURIComponent(externalPaymentId)}`, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const payment = await readPaymentResponse(response);
    return {
      externalPaymentId: String(payment.id ?? externalPaymentId),
      externalReference: payment.external_reference ?? "",
      amountCents: Math.round(Number(payment.transaction_amount) * 100),
      currency: payment.currency_id ?? "",
      status: payment.status ?? "",
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
  const account = await response.json() as { id?: number; nickname?: string; site_id?: string; message?: string };
  if (!response.ok || !account.id) throw new Error(account.message || "O Mercado Pago recusou a credencial.");
  return {
    accountId: String(account.id),
    nickname: account.nickname ?? "Conta Mercado Pago",
    siteId: account.site_id ?? "MLB",
    durationMs: Date.now() - startedAt,
  };
}

async function requireCredential() {
  const credential = await getMercadoPagoCredential();
  if (!credential) throw new Error("As credenciais do Mercado Pago não estão configuradas.");
  return credential;
}

async function readPaymentResponse(response: Response) {
  const body = await response.json() as {
    id?: string | number;
    status?: string;
    external_reference?: string;
    transaction_amount?: number;
    currency_id?: string;
    point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
    message?: string;
  };
  if (!response.ok) throw new Error(body.message || `O Mercado Pago respondeu HTTP ${response.status}.`);
  return body;
}