import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { updateCustomerServiceStatus } from "../crm";

export type PaymentRequestStatus = "awaiting_human_confirmation" | "paid" | "rejected";

export interface PaymentRequestDocument {
  _id: ObjectId;
  customerId: ObjectId;
  amountCents: number;
  pixKeySnapshot: string;
  recipientNameSnapshot: string;
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