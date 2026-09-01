import "server-only";

import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";

export const DYNAMIC_COLLECTIONS = [
  "assistant_response_jobs",
  "assistant_conversation_states",
  "assistant_customer_flows",
  "assistant_flow_history",
  "assistant_flow_runs",
  "calendar_appointments",
  "calendar_visit_options",
  "crm_customers",
  "payment_requests",
  "whatsapp_messages",
] as const;

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