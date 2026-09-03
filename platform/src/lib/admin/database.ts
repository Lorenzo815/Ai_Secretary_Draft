import "server-only";

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