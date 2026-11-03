import "server-only";

import { Collection, ObjectId } from "mongodb";

import { updateCustomerServiceStatus } from "../crm";
import { cancelCharge, createPaymentLink, createPixCharge } from "./providers/mercado-pago";
import { recordManualReview } from "./ledger";
import type { MercadoPagoSettings } from "./provider-config";
import { withCurrentCompany } from "../companies/context";
import { tenantDb } from "../companies/tenant-db";

export type PaymentRequestStatus = "awaiting_human_confirmation" | "awaiting_provider_confirmation" | "paid" | "rejected" | "provider_error";

export interface PaymentRequestDocument {
  _id: ObjectId;
  customerId: ObjectId;
  amountCents: number;
  provider?: "manual" | "mercado_pago";
  /** Mercado Pago only: Pix code in the chat or payment link. Missing on requests created before links existed (Pix). */
  channel?: "pix" | "payment_link";
  pixKeySnapshot: string;
  recipientNameSnapshot: string;
  payerEmail?: string;
  externalPaymentId?: string;
  providerStatus?: string;
  providerError?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  paymentUrl?: string;
  expiresAt?: Date;
  /** The Mercado Pago payment that settled this request. */
  providerPaymentId?: string;
  paidAt?: Date;
  status: PaymentRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNote?: string;
}

const DB_NAME = "ai_secretary";

async function getPaymentRequestsCollection(): Promise<Collection<PaymentRequestDocument>> {
  return (await tenantDb()).collection<PaymentRequestDocument>("payment_requests");
}

export async function createPaymentRequest(input: {
  customerId: ObjectId;
  amountCents: number;
  pixKey: string;
  recipientName: string;
}) {
  if (!input.pixKey.trim() || !input.recipientName.trim()) {
    throw new Error("A chave Pix e o favorecido ainda não foram configurados pela clínica.");
  }
  const requests = await getPaymentRequestsCollection();
  const existing = await requests.findOne({
    customerId: input.customerId,
    status: "awaiting_human_confirmation",
  });
  if (existing) return existing;
  const now = new Date();
  const request: PaymentRequestDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    amountCents: input.amountCents,
    provider: "manual",
    pixKeySnapshot: input.pixKey.trim(),
    recipientNameSnapshot: input.recipientName.trim(),
    status: "awaiting_human_confirmation",
    createdAt: now,
    updatedAt: now,
  };
  await requests.insertOne(await withCurrentCompany(request));
  await requests.createIndex(
    { customerId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "awaiting_human_confirmation" } },
  );
  await updateCustomerServiceStatus(input.customerId, "waiting_human");
  return request;
}

export async function getLatestPaymentRequest(customerId: ObjectId) {
  return (await getPaymentRequestsCollection()).findOne(
    { customerId },
    { sort: { createdAt: -1 } },
  );
}

export async function reviewPaymentRequest(input: {
  customerId: ObjectId;
  status: "paid" | "rejected";
  reviewedBy: string;
  note?: string;
}) {
  const requests = await getPaymentRequestsCollection();
  const now = new Date();
  // Manual Pix is reviewed by staff. A pending Mercado Pago charge can also be confirmed by staff as a last
  // resort (e.g. a notification that never arrived), but not rejected: it simply expires at Mercado Pago.
  const payment = await requests.findOneAndUpdate(
    {
      customerId: input.customerId,
      status: input.status === "paid"
        ? { $in: ["awaiting_human_confirmation", "awaiting_provider_confirmation"] }
        : "awaiting_human_confirmation",
    },
    {
      $set: {
        ...(input.status === "paid" ? { paidAt: now } : {}),
        status: input.status,
        reviewedAt: now,
        reviewedBy: input.reviewedBy,
        reviewNote: input.note?.trim().slice(0, 500),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!payment) throw new Error("Não há sinal pendente para este cliente.");
  await recordManualReview({
    paymentRequestId: payment._id, customerId: payment.customerId, amountCents: payment.amountCents,
    status: input.status === "paid" ? "approved" : "rejected", reviewedBy: input.reviewedBy, note: input.note,
    channel: payment.provider === "mercado_pago" ? payment.channel ?? "pix" : "manual_pix",
  });
  return payment;
}

export type MercadoPagoChannel = "pix" | "payment_link";

/**
 * Creates (or reuses) a Mercado Pago charge for the customer's deposit: a Pix code for the chat, or a payment link
 * (card, boleto, Pix) on Mercado Pago's page. A pending charge of the same channel that hasn't expired is reused;
 * an expired one, or one of the other channel, is closed (and cancelled at Mercado Pago, best effort) first.
 */
export async function createMercadoPagoPaymentRequest(input: {
  customerId: ObjectId;
  amountCents: number;
  payerEmail: string;
  payerName?: string;
  channel: MercadoPagoChannel;
  settings: MercadoPagoSettings;
  notificationUrl?: string;
}) {
  const payerEmail = input.payerEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
    throw new Error("O e-mail do pagador é obrigatório para gerar a cobrança no Mercado Pago.");
  }
  const requests = await getPaymentRequestsCollection();
  await requests.createIndex(
    { customerId: 1 },
    {
      name: "unique_pending_automatic_payment",
      unique: true,
      partialFilterExpression: { status: "awaiting_provider_confirmation" },
    },
  );
  const now = new Date();
  const existing = await requests.findOne({
    customerId: input.customerId,
    status: { $in: ["awaiting_human_confirmation", "awaiting_provider_confirmation"] },
  });
  if (existing?.status === "awaiting_human_confirmation") return existing;
  if (existing) {
    const channel = existing.channel ?? "pix";
    const expired = existing.expiresAt !== undefined && existing.expiresAt <= now;
    if (channel === input.channel && !expired) return existing;
    if (existing.externalPaymentId) await cancelCharge({ method: channel, externalId: existing.externalPaymentId });
    await requests.updateOne(
      { _id: existing._id, status: "awaiting_provider_confirmation" },
      { $set: { status: "rejected", providerStatus: expired ? "expired" : "superseded", updatedAt: now } },
    );
  }

  const request: PaymentRequestDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    amountCents: input.amountCents,
    provider: "mercado_pago",
    channel: input.channel,
    pixKeySnapshot: "",
    recipientNameSnapshot: "Mercado Pago",
    payerEmail,
    status: "awaiting_provider_confirmation",
    createdAt: now,
    updatedAt: now,
  };
  await requests.insertOne(await withCurrentCompany(request));
  await updateCustomerServiceStatus(input.customerId, "waiting_human");
  try {
    const description = "Sinal de atendimento";
    const fields = input.channel === "pix"
      ? await createPixCharge({
          paymentRequestId: request._id, amountCents: request.amountCents, payerEmail, payerFirstName: input.payerName,
          description, expiryMinutes: input.settings.pixExpiryMinutes,
        }).then((pix) => ({
          externalPaymentId: pix.orderId, providerStatus: pix.status, qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64,
          ticketUrl: pix.ticketUrl, expiresAt: pix.expiresAt ?? new Date(now.getTime() + input.settings.pixExpiryMinutes * 60_000),
        }))
      : await createPaymentLink({
          paymentRequestId: request._id, amountCents: request.amountCents, payerEmail, description,
          methods: input.settings.linkMethods, maxInstallments: input.settings.maxInstallments,
          expiresAt: new Date(now.getTime() + input.settings.linkExpiryHours * 3_600_000), notificationUrl: input.notificationUrl,
        }).then((link) => ({
          externalPaymentId: link.preferenceId, providerStatus: "link_created", paymentUrl: link.url, expiresAt: link.expiresAt,
        }));
    const updated = await requests.findOneAndUpdate(
      { _id: request._id, status: "awaiting_provider_confirmation" },
      { $set: { ...fields, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    return updated ?? { ...request, ...fields };
  } catch (error) {
    // Keep the provider's reason (no secrets: Mercado Pago only returns a message and error codes).
    const providerError = error instanceof Error ? error.message.slice(0, 300) : "Erro desconhecido";
    console.error("Mercado Pago charge creation failed.", { paymentRequestId: request._id.toHexString(), providerError });
    await requests.updateOne(
      { _id: request._id, status: "awaiting_provider_confirmation" },
      { $set: { status: "provider_error", providerStatus: "creation_failed", providerError, updatedAt: new Date() } },
    );
    throw error;
  }
}

export async function findPaymentRequestById(id: string) {
  if (!ObjectId.isValid(id)) return null;
  return (await getPaymentRequestsCollection()).findOne({ _id: new ObjectId(id) });
}

export async function applyProviderPaymentStatus(input: {
  paymentRequestId: ObjectId;
  status: "paid" | "rejected";
  providerStatus: string;
  providerPaymentId?: string;
}) {
  const now = new Date();
  return (await getPaymentRequestsCollection()).findOneAndUpdate(
    {
      _id: input.paymentRequestId,
      provider: "mercado_pago",
      status: "awaiting_provider_confirmation",
    },
    { $set: {
      status: input.status,
      providerStatus: input.providerStatus,
      ...(input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : {}),
      ...(input.status === "paid" ? { paidAt: now } : {}),
      reviewedAt: now,
      reviewedBy: "mercado_pago:webhook",
      updatedAt: now,
    } },
    { returnDocument: "after" },
  );
}
