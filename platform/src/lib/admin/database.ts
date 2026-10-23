import "server-only";

import { ObjectId } from "mongodb";
import type { CustomerDocument } from "../crm";
import { getWhatsAppPhoneAliases } from "../crm/validation";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";

export const DYNAMIC_COLLECTIONS = [
  "automation_jobs",
  "assistant_conversation_states",
  "assistant_runs",
  "assistant_run_steps",
  "ai_task_calls",
  "calendar_plan_options",
  "lead_qualification_history",
  "payment_requests",
  "calendar_appointments",
  "crm_customers",
  "whatsapp_messages",
] as const;

export const CUSTOMER_CHAT_COLLECTIONS = [
  "automation_jobs",
  "assistant_conversation_states",
  "assistant_runs",
  "assistant_run_steps",
  "lead_qualification_history",
  "whatsapp_messages",
] as const;

export class ChatHistoryInProgressError extends Error {
  constructor() {
    super("Há processamento em andamento para este cliente. Aguarde a conclusão antes de apagar o histórico.");
    this.name = "ChatHistoryInProgressError";
  }
}

export async function clearChatHistoryForCustomer(customerId: ObjectId) {
  const client = await clientPromise;
  const database = client.db(DB_NAME);
  const customers = database.collection<CustomerDocument>("crm_customers");
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const customer = await customers.findOne(
        { _id: customerId },
        { projection: { phones: 1 }, session },
      );
      if (!customer) return null;

      const conversationJobs = {
        customerId,
        process: { $in: ["customer_agent", "customer_follow_up", "lead_qualification"] },
      };
      const activeJob = await database.collection("automation_jobs").findOne(
        { ...conversationJobs, status: "processing" },
        { projection: { _id: 1 }, session },
      );
      const activeAnalysis = await database.collection("lead_qualification_locks").findOne(
        { customerId, leaseUntil: { $gt: new Date() } },
        { projection: { _id: 1 }, session },
      );
      if (activeJob || activeAnalysis) throw new ChatHistoryInProgressError();

      const phones = [...new Set(customer.phones.flatMap(getWhatsAppPhoneAliases))];
      const deleted: Record<string, number> = {};
      for (const name of CUSTOMER_CHAT_COLLECTIONS) {
        const filter = name === "whatsapp_messages"
          ? { $or: [{ customerId }, { customerId: null, contactPhone: { $in: phones } }] }
          : name === "automation_jobs" ? conversationJobs : { customerId };
        const result = await database.collection(name).deleteMany(filter, { session });
        deleted[name] = result.deletedCount;
      }
      await customers.updateOne(
        { _id: customerId },
        { $unset: { leadQualification: "", whatsappAttention: "" }, $set: { updatedAt: new Date() } },
        { session },
      );
      return deleted;
    });
  } finally {
    await session.endSession();
  }
}

export async function clearDynamicData() {
  const client = await clientPromise;
  const database = client.db(DB_NAME);
  const results = await Promise.all(
    DYNAMIC_COLLECTIONS.map(async (collectionName) => {
      const result = await database.collection(collectionName).deleteMany({});
      return [collectionName, result.deletedCount] as const;
    }),
  );

  return Object.fromEntries(results);
}

export async function clearDynamicDataForCustomer(customerId: ObjectId) {
  const client = await clientPromise;
  const database = client.db(DB_NAME);
  const customer = await database.collection("crm_customers").findOne(
    { _id: customerId },
    { projection: { phones: 1 } },
  );
  if (!customer) return null;

  const results = await Promise.all(
    DYNAMIC_COLLECTIONS.map(async (collectionName) => {
      const filter = collectionName === "crm_customers"
        ? { _id: customerId }
        : collectionName === "whatsapp_messages"
          ? { $or: [{ customerId }, { contactPhone: { $in: customer.phones ?? [] } }] }
          : { customerId };
      const result = await database.collection(collectionName).deleteMany(filter);
      return [collectionName, result.deletedCount] as const;
    }),
  );

  return Object.fromEntries(results);
}