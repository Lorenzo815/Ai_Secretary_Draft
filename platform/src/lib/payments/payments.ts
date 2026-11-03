import "server-only";

import { Collection, ObjectId, type UpdateFilter } from "mongodb";

import { updateCustomerServiceStatus } from "../crm";
import { cancelCharge, createPaymentLink, createPixCharge } from "./providers/mercado-pago";
import { recordManualEntry, recordManualReview } from "./ledger";
import type { MercadoPagoSettings } from "./provider-config";
import { depositRequired, resolvePlanPayment } from "./plan-payment";
import type { SchedulingPlan } from "../assistant/agent/contracts";
import { withCurrentCompany } from "../companies/context";
import { tenantDb } from "../companies/tenant-db";

export type PaymentRequestStatus = "awaiting_human_confirmation" | "awaiting_provider_confirmation" | "paid" | "rejected" | "provider_error";

import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "./manual-methods";
export { MANUAL_PAYMENT_METHODS, MANUAL_METHOD_LABELS, type ManualPaymentMethod } from "./manual-methods";

/** What a deposit is for: the plan, the held option and the appointments it covers once paid. */
export interface PaymentAllocation {
  planKey?: string;
  schedulingOptionId?: ObjectId;
  appointmentIds: ObjectId[];
}

export interface PaymentRequestDocument {
  _id: ObjectId;
  customerId: ObjectId;
  amountCents: number;
  provider?: "manual" | "mercado_pago";
  /** Plan and option the deposit was requested for (missing on requests created before deposits were per booking). */
  planKey?: string;
  schedulingOptionId?: ObjectId;
  /** Appointments this payment covers. Set at creation from the held option, on confirmation, or by staff. */
  appointmentIds?: ObjectId[];
  /** Payments registered by staff (cash, card machine, Pix or transfer straight to the clinic, insurance). */
  manualMethod?: ManualPaymentMethod;
  createdBy?: string;
  /** Set when Mercado Pago reports a refund or chargeback of the settling payment. */
  refundedAt?: Date;
  refundStatus?: string;
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
  allocation?: PaymentAllocation;
}) {
  if (!input.pixKey.trim() || !input.recipientName.trim()) {
    throw new Error("A chave Pix e o favorecido ainda não foram configurados pela clínica.");
  }
  const requests = await getPaymentRequestsCollection();
  const existing = await requests.findOne({
    customerId: input.customerId,
    status: "awaiting_human_confirmation",
  });
  if (existing && sameBooking(existing, input.allocation)) return existing;
  const now = new Date();
  if (existing) {
    // A pending manual Pix for another booking is replaced: only one deposit is awaited at a time.
    await requests.updateOne(
      { _id: existing._id, status: "awaiting_human_confirmation" },
      { $set: { status: "rejected", reviewNote: "Substituída por um novo sinal.", reviewedBy: "system", reviewedAt: now, updatedAt: now } },
    );
  }
  const request: PaymentRequestDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    amountCents: input.amountCents,
    ...allocationFields(input.allocation),
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
  allocation?: PaymentAllocation;
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
    // A request without a provider charge (creation interrupted) is never reused: it is replaced below.
    if (channel === input.channel && !expired && existing.externalPaymentId && sameBooking(existing, input.allocation)) return existing;
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
    ...allocationFields(input.allocation),
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

function sameBooking(existing: PaymentRequestDocument, allocation?: PaymentAllocation) {
  if (!allocation?.schedulingOptionId) return !existing.schedulingOptionId;
  return Boolean(existing.schedulingOptionId?.equals(allocation.schedulingOptionId));
}

function allocationFields(allocation?: PaymentAllocation) {
  if (!allocation) return {};
  return {
    ...(allocation.planKey ? { planKey: allocation.planKey } : {}),
    ...(allocation.schedulingOptionId ? { schedulingOptionId: allocation.schedulingOptionId } : {}),
    appointmentIds: allocation.appointmentIds,
  };
}

/** The plan's deposit rule and whether a new booking of it by this patient needs a deposit now. */
export async function depositForPlan(
  customerId: ObjectId,
  plan: Pick<SchedulingPlan, "key" | "payment" | "prerequisites">,
  legacyAmountCents: number,
) {
  const payment = plan.key.startsWith("event:")
    ? { requirement: "none" as const, amountCents: legacyAmountCents }
    : resolvePlanPayment(plan, legacyAmountCents);
  const paidBefore = payment.requirement === "first_time" ? await hasPaidDepositBefore(customerId) : false;
  return { ...payment, required: depositRequired(payment, { hasPaidDepositBefore: paidBefore }) };
}

/** Whether the patient ever had a deposit paid at this clinic, refunds and chargebacks excluded ("first time" rule). */
export async function hasPaidDepositBefore(customerId: ObjectId) {
  return Boolean(await (await getPaymentRequestsCollection()).findOne(
    { customerId, status: "paid", refundedAt: { $exists: false } },
    { projection: { _id: 1 } },
  ));
}

/**
 * A deposit paid for a booking whose hold expired before the payment arrived: it can confirm a new booking.
 * Only requests created per booking qualify, so old payments are never reused as credit.
 */
export async function findUnallocatedPaidPayment(customerId: ObjectId) {
  return (await getPaymentRequestsCollection()).findOne(
    {
      customerId, status: "paid", refundedAt: { $exists: false },
      schedulingOptionId: { $exists: true }, appointmentIds: { $size: 0 },
    },
    { sort: { paidAt: 1 } },
  );
}

/** The pending deposit for a held option, if any. */
export async function findPendingPaymentForOption(customerId: ObjectId, schedulingOptionId: ObjectId) {
  return (await getPaymentRequestsCollection()).findOne({
    customerId, schedulingOptionId, status: { $in: ["awaiting_human_confirmation", "awaiting_provider_confirmation"] },
  });
}

export async function findPaymentRequestsForCustomer(customerId: ObjectId) {
  return (await getPaymentRequestsCollection()).find({ customerId }).sort({ createdAt: -1 }).limit(100).toArray();
}

export async function setPaymentAppointments(paymentRequestId: ObjectId, appointmentIds: ObjectId[]) {
  return (await getPaymentRequestsCollection()).findOneAndUpdate(
    { _id: paymentRequestId },
    { $set: { appointmentIds, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

export async function markPaymentRefunded(paymentRequestId: ObjectId, refundStatus: string) {
  await (await getPaymentRequestsCollection()).updateOne(
    { _id: paymentRequestId, status: "paid", refundedAt: { $exists: false } },
    { $set: { refundedAt: new Date(), refundStatus, updatedAt: new Date() } },
  );
}

export interface PaymentListFilter {
  view: "processed" | "all";
  from?: Date;
  to?: Date;
  customerId?: ObjectId;
  provider?: "manual" | "mercado_pago";
}

export async function listPaymentRequests(filter: PaymentListFilter) {
  const query: Record<string, unknown> = {};
  if (filter.view === "processed") query.status = "paid";
  if (filter.customerId) query.customerId = filter.customerId;
  if (filter.provider) query.provider = filter.provider;
  const dateField = filter.view === "processed" ? "paidAt" : "createdAt";
  if (filter.from || filter.to) {
    const range = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}) };
    // Deposits confirmed by staff before paidAt existed only have the review time.
    if (dateField === "paidAt") query.$or = [{ paidAt: range }, { paidAt: { $exists: false }, reviewedAt: range }];
    else query[dateField] = range;
  }
  return (await getPaymentRequestsCollection())
    .find(query)
    .sort({ [dateField]: -1, createdAt: -1 })
    .limit(500)
    .toArray();
}

/** A payment received outside the system (cash, card machine, direct Pix or transfer, insurance), registered by staff. */
export async function createManualPaymentEntry(input: {
  customerId: ObjectId;
  amountCents: number;
  method: ManualPaymentMethod;
  receivedAt: Date;
  note?: string;
  createdBy: string;
  appointmentIds: ObjectId[];
}) {
  if (!MANUAL_PAYMENT_METHODS.includes(input.method)) throw new Error("Forma de pagamento inválida.");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100_000_000) {
    throw new Error("Valor inválido.");
  }
  if (Number.isNaN(input.receivedAt.getTime()) || input.receivedAt.getTime() > Date.now() + 60_000) {
    throw new Error("Data do recebimento inválida.");
  }
  const now = new Date();
  const request: PaymentRequestDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    amountCents: input.amountCents,
    provider: "manual",
    manualMethod: input.method,
    pixKeySnapshot: "",
    recipientNameSnapshot: "",
    appointmentIds: input.appointmentIds,
    status: "paid",
    paidAt: input.receivedAt,
    reviewedAt: now,
    reviewedBy: input.createdBy,
    reviewNote: input.note?.trim().slice(0, 500) || undefined,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await (await getPaymentRequestsCollection()).insertOne(await withCurrentCompany(request));
  await recordManualEntry({
    paymentRequestId: request._id, customerId: request.customerId, amountCents: request.amountCents,
    method: input.method, receivedAt: input.receivedAt, createdBy: input.createdBy, note: input.note,
  });
  return request;
}

export async function getPaymentRequest(paymentRequestId: ObjectId) {
  return (await getPaymentRequestsCollection()).findOne({ _id: paymentRequestId });
}

/** An appointment is covered by one payment: linking it to a payment unlinks it from any other. */
export async function unlinkAppointmentsFromOtherPayments(appointmentIds: ObjectId[], keepPaymentRequestId: ObjectId) {
  if (appointmentIds.length === 0) return;
  await (await getPaymentRequestsCollection()).updateMany(
    { _id: { $ne: keepPaymentRequestId }, appointmentIds: { $in: appointmentIds } },
    // The driver's types don't infer $pull on an optional array field.
    { $pull: { appointmentIds: { $in: appointmentIds } }, $set: { updatedAt: new Date() } } as unknown as UpdateFilter<PaymentRequestDocument>,
  );
}

/** Deletes a payment registered by staff in Financeiro. Deposits charged through the chat can't be deleted. */
export async function deleteManualPaymentEntry(paymentRequestId: ObjectId) {
  return (await getPaymentRequestsCollection()).findOneAndDelete({
    _id: paymentRequestId, provider: "manual", manualMethod: { $exists: true },
  });
}
