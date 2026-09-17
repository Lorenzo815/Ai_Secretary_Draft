import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { updateCustomerServiceStatus } from "../crm";
import { getAutomaticPaymentProvider } from "./providers/registry";

export type PaymentRequestStatus = "awaiting_human_confirmation" | "awaiting_provider_confirmation" | "paid" | "rejected" | "provider_error";

export interface PaymentRequestDocument {
  _id: ObjectId;
  customerId: ObjectId;
  amountCents: number;
  provider?: "manual" | "mercado_pago";
  pixKeySnapshot: string;
  recipientNameSnapshot: string;
  payerEmail?: string;
  externalPaymentId?: string;
  providerStatus?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  status: PaymentRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNote?: string;
}

const DB_NAME = "ai_secretary";

async function getPaymentRequestsCollection(): Promise<Collection<PaymentRequestDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<PaymentRequestDocument>("payment_requests");
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
  await requests.insertOne(request);
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
  const payment = await requests.findOneAndUpdate(
    { customerId: input.customerId, status: "awaiting_human_confirmation" },
    {
      $set: {
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
  return payment;
}

export async function createMercadoPagoPaymentRequest(input: {
  customerId: ObjectId;
  amountCents: number;
  payerEmail: string;
}) {
  const payerEmail = input.payerEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
    throw new Error("O e-mail do pagador é obrigatório para gerar o Pix no Mercado Pago.");
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
  const existing = await requests.findOne({
    customerId: input.customerId,
    status: { $in: ["awaiting_human_confirmation", "awaiting_provider_confirmation"] },
  });
  if (existing) return existing;
  const now = new Date();
  const request: PaymentRequestDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    amountCents: input.amountCents,
    provider: "mercado_pago",
    pixKeySnapshot: "",
    recipientNameSnapshot: "Mercado Pago",
    payerEmail,
    status: "awaiting_provider_confirmation",
    createdAt: now,
    updatedAt: now,
  };
  await requests.insertOne(request);
  await updateCustomerServiceStatus(input.customerId, "waiting_human");
  try {
    const providerPayment = await getAutomaticPaymentProvider("mercado_pago").createPayment({
      paymentRequestId: request._id,
      amountCents: request.amountCents,
      payerEmail,
      description: "Sinal de atendimento Oria",
    });
    const updated = await requests.findOneAndUpdate(
      { _id: request._id, status: "awaiting_provider_confirmation" },
      { $set: {
        externalPaymentId: providerPayment.externalPaymentId,
        providerStatus: providerPayment.status,
        qrCode: providerPayment.qrCode,
        qrCodeBase64: providerPayment.qrCodeBase64,
        ticketUrl: providerPayment.ticketUrl,
        updatedAt: new Date(),
      } },
      { returnDocument: "after" },
    );
    return updated ?? request;
  } catch (error) {
    await requests.updateOne(
      { _id: request._id, status: "awaiting_provider_confirmation" },
      { $set: { status: "provider_error", providerStatus: "creation_failed", updatedAt: new Date() } },
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
  externalPaymentId: string;
  status: "paid" | "rejected";
  providerStatus: string;
}) {
  return (await getPaymentRequestsCollection()).findOneAndUpdate(
    {
      _id: input.paymentRequestId,
      provider: "mercado_pago",
      externalPaymentId: input.externalPaymentId,
      status: "awaiting_provider_confirmation",
    },
    { $set: {
      status: input.status,
      providerStatus: input.providerStatus,
      reviewedAt: new Date(),
      reviewedBy: "mercado_pago:webhook",
      updatedAt: new Date(),
    } },
    { returnDocument: "after" },
  );
}