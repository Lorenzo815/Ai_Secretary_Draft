import "server-only";

import { getMercadoPagoCredential } from "../provider-credentials";
import type { PaymentLinkMethod } from "../provider-config";
import type {
  MercadoPagoOrder, MercadoPagoPayment, PaymentLink, PaymentLinkInput, PixCharge, PixChargeInput,
} from "./types";

// Pix in the chat uses the Orders API (/v1/orders); the payment link uses Checkout Pro (/checkout/preferences).
// Both accept test credentials. Payment attempts (any method) are read from /v1/payments.
const API_URL = "https://api.mercadopago.com";
const ALL_LINK_TYPES: PaymentLinkMethod[] = ["credit_card", "debit_card", "ticket", "bank_transfer"];
// Types Checkout Pro may offer that the clinic never enables here.
const ALWAYS_EXCLUDED_TYPES = ["prepaid_card", "atm", "digital_currency", "digital_wallet"];

const cents = (value: unknown) => Math.round(Number(value) * 100);
const amount = (amountCents: number) => (amountCents / 100).toFixed(2);

export async function createPixCharge(input: PixChargeInput): Promise<PixCharge> {
  const credential = await requireCredential();
  const firstName = input.payerFirstName?.trim().split(/\s+/)[0]?.slice(0, 60);
  const order = await request<OrderResponse>("/v1/orders", credential.accessToken, {
    method: "POST",
    headers: { "X-Idempotency-Key": input.paymentRequestId.toHexString() },
    body: {
      type: "online",
      processing_mode: "automatic",
      external_reference: input.paymentRequestId.toHexString(),
      total_amount: amount(input.amountCents),
      description: input.description,
      payer: { email: input.payerEmail, ...(firstName ? { first_name: firstName } : {}) },
      transactions: { payments: [{
        amount: amount(input.amountCents),
        payment_method: { id: "pix", type: "bank_transfer" },
        expiration_time: `PT${input.expiryMinutes}M`,
      }] },
    },
  });
  const payment = order.transactions?.payments?.[0];
  const pix = payment?.payment_method;
  if (!order.id || !pix?.qr_code) throw new Error("O Mercado Pago não retornou um Pix válido.");
  return {
    orderId: order.id,
    status: order.status ?? "action_required",
    qrCode: pix.qr_code,
    qrCodeBase64: pix.qr_code_base64 || undefined,
    ticketUrl: pix.ticket_url,
    expiresAt: payment?.date_of_expiration ? new Date(payment.date_of_expiration) : undefined,
  };
}

export async function createPaymentLink(input: PaymentLinkInput): Promise<PaymentLink> {
  const credential = await requireCredential();
  const excluded = [...ALL_LINK_TYPES.filter((type) => !input.methods.includes(type)), ...ALWAYS_EXCLUDED_TYPES];
  const preference = await request<PreferenceResponse>("/checkout/preferences", credential.accessToken, {
    method: "POST",
    headers: { "X-Idempotency-Key": input.paymentRequestId.toHexString() },
    body: {
      items: [{ id: "sinal", title: input.description, quantity: 1, unit_price: input.amountCents / 100, currency_id: "BRL" }],
      external_reference: input.paymentRequestId.toHexString(),
      payer: { email: input.payerEmail },
      payment_methods: {
        excluded_payment_types: excluded.map((id) => ({ id })),
        installments: input.methods.includes("credit_card") ? input.maxInstallments : 1,
      },
      binary_mode: false,
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: input.expiresAt.toISOString(),
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      statement_descriptor: "SINAL CONSULTA",
    },
  });
  if (!preference.id || !preference.init_point) throw new Error("O Mercado Pago não retornou um link de pagamento.");
  return { preferenceId: preference.id, url: preference.init_point, expiresAt: input.expiresAt };
}

export async function getOrder(orderId: string): Promise<MercadoPagoOrder> {
  const credential = await requireCredential();
  const order = await request<OrderResponse>(`/v1/orders/${encodeURIComponent(orderId)}`, credential.accessToken);
  return {
    orderId: order.id ?? orderId,
    externalReference: order.external_reference ?? "",
    amountCents: cents(order.total_amount),
    // Orders carry the country rather than always a currency; Brazilian orders are always in reais.
    currency: order.currency ?? order.currency_id ?? (order.country_code === "BRA" ? "BRL" : ""),
    status: order.status ?? "",
    statusDetail: order.status_detail ?? "",
  };
}

export async function getPayment(paymentId: string): Promise<MercadoPagoPayment> {
  const credential = await requireCredential();
  return parsePayment(await request<PaymentResponse>(`/v1/payments/${encodeURIComponent(paymentId)}`, credential.accessToken));
}

/** Every payment attempt Mercado Pago recorded for one of our requests (its id is the external reference). */
export async function findPaymentsByReference(externalReference: string): Promise<MercadoPagoPayment[]> {
  const credential = await requireCredential();
  const query = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "asc", limit: "50" });
  const result = await request<{ results?: PaymentResponse[] }>(`/v1/payments/search?${query}`, credential.accessToken);
  return (result.results ?? []).map(parsePayment);
}

/** Best effort: stops an outdated charge from being paid. */
export async function cancelCharge(input: { method: "pix" | "payment_link"; externalId: string }) {
  const credential = await requireCredential();
  try {
    if (input.method === "pix") {
      await request(`/v1/orders/${encodeURIComponent(input.externalId)}/cancel`, credential.accessToken, {
        method: "POST", headers: { "X-Idempotency-Key": `cancel-${input.externalId}` },
      });
    } else {
      await request(`/checkout/preferences/${encodeURIComponent(input.externalId)}`, credential.accessToken, {
        method: "PUT", body: { expires: true, expiration_date_to: new Date().toISOString() },
      });
    }
    return true;
  } catch {
    return false;
  }
}

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

function parsePayment(payment: PaymentResponse): MercadoPagoPayment {
  const fees = payment.fee_details?.reduce((sum, fee) => sum + Number(fee.amount ?? 0), 0);
  return {
    paymentId: String(payment.id ?? ""),
    externalReference: payment.external_reference ?? "",
    amountCents: cents(payment.transaction_amount),
    paidAmountCents: cents(payment.transaction_details?.total_paid_amount ?? payment.transaction_amount),
    netReceivedCents: payment.transaction_details?.net_received_amount !== undefined ? cents(payment.transaction_details.net_received_amount) : null,
    feeCents: fees !== undefined ? Math.round(fees * 100) : null,
    currency: payment.currency_id ?? "",
    status: payment.status ?? "",
    statusDetail: payment.status_detail ?? "",
    paymentType: payment.payment_type_id ?? "",
    paymentMethod: payment.payment_method_id ?? "",
    installments: typeof payment.installments === "number" ? payment.installments : null,
    payerEmail: payment.payer?.email ?? null,
    createdAt: payment.date_created ? new Date(payment.date_created) : null,
    approvedAt: payment.date_approved ? new Date(payment.date_approved) : null,
    liveMode: typeof payment.live_mode === "boolean" ? payment.live_mode : null,
  };
}

async function requireCredential() {
  const credential = await getMercadoPagoCredential();
  if (!credential) throw new Error("As credenciais do Mercado Pago não estão configuradas.");
  return credential;
}

async function request<T = unknown>(path: string, accessToken: string, init: {
  method?: string; headers?: Record<string, string>; body?: unknown;
} = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as ErrorResponse;
  if (!response.ok) {
    const reasons = [
      ...(body.errors ?? []).map((error) => [error.code, error.message, ...(error.details ?? [])].filter(Boolean).join(" ")),
      ...(body.cause ?? []).map((cause) => [cause.code, cause.description].filter(Boolean).join(" ")),
    ].filter(Boolean).join("; ");
    throw new Error(`Mercado Pago HTTP ${response.status}: ${body.message ?? "erro"}${reasons ? ` (${reasons})` : ""}`.slice(0, 300));
  }
  return body as T;
}

interface ErrorResponse {
  message?: string;
  errors?: Array<{ code?: string; message?: string; details?: string[] }>;
  cause?: Array<{ code?: number | string; description?: string }>;
}

interface OrderResponse {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string | number;
  currency?: string;
  currency_id?: string;
  country_code?: string;
  transactions?: { payments?: Array<{
    id?: string;
    date_of_expiration?: string;
    payment_method?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
  }> };
}

interface PreferenceResponse { id?: string; init_point?: string; sandbox_init_point?: string }

interface PaymentResponse {
  id?: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_type_id?: string;
  payment_method_id?: string;
  installments?: number;
  date_created?: string;
  date_approved?: string;
  live_mode?: boolean;
  payer?: { email?: string };
  fee_details?: Array<{ amount?: number }>;
  transaction_details?: { total_paid_amount?: number; net_received_amount?: number };
}
