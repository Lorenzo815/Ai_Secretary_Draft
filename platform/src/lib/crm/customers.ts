import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";

export interface CustomerIdentifier {
  kind: string;
  value: string;
  provider?: string;
}

export type CustomerServiceStatus = "ai_active" | "waiting_human" | "human_active" | "closed";

export interface CustomerDocument {
  _id: ObjectId;
  name: string;
  phones: string[];
  identifiers: CustomerIdentifier[];
  serviceStatus?: CustomerServiceStatus;
  firstInteractionAt: Date;
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerOperationsDocument extends CustomerDocument {
  flow?: {
    flowKey: string;
    flowVersion: number;
    status: "active" | "completed";
    state: { stage: string; missingData: string[] };
    completionCode?: string;
    completionReason?: string;
  };
  conversationState?: { summary: string; updatedAt: Date };
  nextAppointment?: {
    _id: ObjectId;
    startAt: Date;
    timezone: string;
    status: "scheduled";
  };
  latestMessage?: { direction: "inbound" | "outbound"; body: string; timestamp: Date };
}

const DB_NAME = "ai_secretary";

async function getCustomersCollection(): Promise<Collection<CustomerDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CustomerDocument>("crm_customers");
}

export async function findOrCreateCustomerFromWhatsApp(input: {
  phone: string;
  name?: string;
  interactionAt: Date;
}) {
  const customers = await getCustomersCollection();
  await ensureCustomerIndexes();

  const phone = input.phone.replace(/\D/g, "");
  const now = new Date();
  const customer = await customers.findOneAndUpdate(
    {
      identifiers: {
        $elemMatch: { kind: "whatsapp_phone", value: phone },
      },
    },
    {
      $set: {
        ...(input.name ? { name: input.name } : {}),
        updatedAt: now,
      },
      $min: { firstInteractionAt: input.interactionAt },
      $max: { lastInteractionAt: input.interactionAt },
      $setOnInsert: {
        _id: new ObjectId(),
        ...(!input.name ? { name: phone } : {}),
        phones: [phone],
        identifiers: [
          { kind: "whatsapp_phone", value: phone, provider: "whatsapp" },
        ],
        serviceStatus: "ai_active",
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!customer) throw new Error("Não foi possível criar o cliente no CRM.");
  return customer;
}

export async function listCustomers() {
  const customers = await getCustomersCollection();
  return customers.find({}).sort({ lastInteractionAt: -1 }).toArray();
}

export async function findCustomerById(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const customers = await getCustomersCollection();
  return customers.findOne({ _id: new ObjectId(id) });
}

export async function updateCustomerServiceStatus(id: ObjectId, status: CustomerServiceStatus) {
  const customer = await (await getCustomersCollection()).findOneAndUpdate(
    { _id: id },
    { $set: { serviceStatus: status, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!customer) throw new Error("Cliente não encontrado.");
  return customer;
}

export async function ensureCustomerIndexes() {
  const customers = await getCustomersCollection();
  await Promise.all([
    customers.createIndex(
      { "identifiers.kind": 1, "identifiers.value": 1 },
      { unique: true },
    ),
    customers.createIndex({ lastInteractionAt: -1 }),
  ]);
}

export async function listCustomerOperations() {
  const customers = await getCustomersCollection();
  const now = new Date();
  return customers.aggregate<CustomerOperationsDocument>([
    { $sort: { lastInteractionAt: -1 } },
    {
      $lookup: {
        from: "assistant_customer_flows",
        let: { customerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$customerId", "$$customerId"] } } },
          { $sort: { updatedAt: -1 } },
          { $limit: 1 },
        ],
        as: "flowDocuments",
      },
    },
    {
      $lookup: {
        from: "assistant_conversation_states",
        localField: "_id",
        foreignField: "customerId",
        as: "conversationDocuments",
      },
    },
    {
      $lookup: {
        from: "calendar_appointments",
        let: { customerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$customerId", "$$customerId"] },
            { $eq: ["$status", "scheduled"] },
            { $gte: ["$startAt", now] },
          ] } } },
          { $sort: { startAt: 1 } },
          { $limit: 1 },
        ],
        as: "appointmentDocuments",
      },
    },
    {
      $lookup: {
        from: "whatsapp_messages",
        let: { customerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$customerId", "$$customerId"] } } },
          { $sort: { timestamp: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, direction: 1, body: 1, timestamp: 1 } },
        ],
        as: "messageDocuments",
      },
    },
    { $set: {
      flow: { $arrayElemAt: ["$flowDocuments", 0] },
      conversationState: { $arrayElemAt: ["$conversationDocuments", 0] },
      nextAppointment: { $arrayElemAt: ["$appointmentDocuments", 0] },
      latestMessage: { $arrayElemAt: ["$messageDocuments", 0] },
    } },
    { $unset: ["flowDocuments", "conversationDocuments", "appointmentDocuments", "messageDocuments"] },
  ]).toArray();
}