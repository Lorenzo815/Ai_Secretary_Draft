import "server-only";

import { ObjectId, type Collection } from "mongodb";
import { withCurrentCompany } from "../companies/context";
import { tenantDb } from "../companies/tenant-db";
import type { MercadoPagoPayment } from "./providers/types";

/**
 * Financial ledger: one row per processed payment event (approved, rejected, refunded, charged back...), from
 * Mercado Pago notifications and from staff reviews of manual Pix. Rows are never edited; a status change of the
 * same payment adds a new row. The basis for the future finance section.
 */
export interface PaymentTransactionDocument {
  _id: ObjectId;
  companyId?: ObjectId;
  /** Unique per company: provider + provider payment id + status. Notification retries don't duplicate rows. */
  key: string;
  paymentRequestId: ObjectId;
  customerId: ObjectId;
  provider: "mercado_pago" | "manual";
  /** How the request was offered: Pix code in the chat, payment link, or the clinic's own Pix key. */
  channel: "pix" | "payment_link" | "manual_pix";
  providerPaymentId: string;
  status: string;
  statusDetail?: string;
  paymentType?: string;
  paymentMethod?: string;
  installments?: number | null;
  currency: string;
  amountCents: number;
  paidAmountCents?: number;
  netReceivedCents?: number | null;
  feeCents?: number | null;
  payerEmail?: string | null;
  liveMode?: boolean | null;
  occurredAt: Date;
  recordedAt: Date;
  source: "mercado_pago_webhook" | "staff_review";
  reviewedBy?: string;
  note?: string;
}

async function getCollection(): Promise<Collection<PaymentTransactionDocument>> {
  const collection = (await tenantDb()).collection<PaymentTransactionDocument>("payment_transactions");
  await ensureIndexes(collection);
  return collection;
}

let indexesPromise: Promise<unknown> | undefined;
function ensureIndexes(collection: Collection<PaymentTransactionDocument>) {
  indexesPromise ??= Promise.all([
    collection.createIndex({ companyId: 1, key: 1 }, { unique: true, name: "company_transaction_key_unique" }),
    collection.createIndex({ companyId: 1, occurredAt: -1 }),
    collection.createIndex({ companyId: 1, customerId: 1, occurredAt: -1 }),
    collection.createIndex({ companyId: 1, paymentRequestId: 1 }),
  ]).catch((error) => { indexesPromise = undefined; throw error; });
  return indexesPromise;
}

async function insertOnce(entry: Omit<PaymentTransactionDocument, "_id" | "recordedAt">) {
  const collection = await getCollection();
  await collection.updateOne(
    { key: entry.key },
    { $setOnInsert: await withCurrentCompany({ ...entry, _id: new ObjectId(), recordedAt: new Date() }) },
    { upsert: true },
  );
}

export async function recordMercadoPagoPayment(input: {
  paymentRequestId: ObjectId;
  customerId: ObjectId;
  channel: "pix" | "payment_link";
  payment: MercadoPagoPayment;
}) {
  const { payment } = input;
  await insertOnce({
    key: `mercado_pago:${payment.paymentId}:${payment.status}`,
    paymentRequestId: input.paymentRequestId,
    customerId: input.customerId,
    provider: "mercado_pago",
    channel: input.channel,
    providerPaymentId: payment.paymentId,
    status: payment.status,
    statusDetail: payment.statusDetail,
    paymentType: payment.paymentType,
    paymentMethod: payment.paymentMethod,
    installments: payment.installments,
    currency: payment.currency || "BRL",
    amountCents: payment.amountCents,
    paidAmountCents: payment.paidAmountCents,
    netReceivedCents: payment.netReceivedCents,
    feeCents: payment.feeCents,
    payerEmail: payment.payerEmail,
    liveMode: payment.liveMode,
    occurredAt: payment.approvedAt ?? payment.createdAt ?? new Date(),
    source: "mercado_pago_webhook",
  });
}

export async function recordManualReview(input: {
  paymentRequestId: ObjectId;
  customerId: ObjectId;
  amountCents: number;
  status: "approved" | "rejected";
  reviewedBy: string;
  note?: string;
  /** manual_pix, or the Mercado Pago channel when staff confirmed a Mercado Pago charge by hand. */
  channel?: PaymentTransactionDocument["channel"];
}) {
  await insertOnce({
    key: `manual:${input.paymentRequestId.toHexString()}:${input.status}`,
    paymentRequestId: input.paymentRequestId,
    customerId: input.customerId,
    provider: "manual",
    channel: input.channel ?? "manual_pix",
    providerPaymentId: input.paymentRequestId.toHexString(),
    status: input.status,
    paymentType: "bank_transfer",
    paymentMethod: "pix",
    currency: "BRL",
    amountCents: input.amountCents,
    paidAmountCents: input.status === "approved" ? input.amountCents : 0,
    occurredAt: new Date(),
    source: "staff_review",
    reviewedBy: input.reviewedBy,
    note: input.note?.trim().slice(0, 500) || undefined,
  });
}

export async function listPaymentTransactions(input: { customerId?: ObjectId; limit?: number } = {}) {
  return (await getCollection())
    .find(input.customerId ? { customerId: input.customerId } : {})
    .sort({ occurredAt: -1 })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500))
    .toArray();
}
