import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";

export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "received" | "sent" | "delivered" | "read" | "failed";

export interface WhatsAppMessageDocument {
  _id: ObjectId;
  customerId?: ObjectId;
  metaMessageId: string;
  contactPhone: string;
  contactName?: string;
  direction: MessageDirection;
  type: string;
  body: string;
  status: MessageStatus;
  timestamp: Date;
  updatedAt: Date;
}

const DB_NAME = "ai_secretary";

async function getMessagesCollection(): Promise<Collection<WhatsAppMessageDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<WhatsAppMessageDocument>("whatsapp_messages");
}

export async function saveWhatsAppMessage(
  message: Omit<WhatsAppMessageDocument, "_id" | "updatedAt">,
) {
  const messages = await getMessagesCollection();
  const now = new Date();

  const result = await messages.updateOne(
    { metaMessageId: message.metaMessageId },
    {
      $set: { ...message, updatedAt: now },
      $setOnInsert: { _id: new ObjectId() },
    },
    { upsert: true },
  );

  return { inserted: result.upsertedCount === 1 };
}

export async function updateWhatsAppMessageStatus(metaMessageId: string, status: MessageStatus) {
  const messages = await getMessagesCollection();
  await messages.updateOne(
    { metaMessageId },
    { $set: { status, updatedAt: new Date() } },
  );
}

export async function listWhatsAppMessages(limit = 100) {
  const messages = await getMessagesCollection();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return messages
    .find({}, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .limit(safeLimit)
    .toArray();
}

export async function listWhatsAppMessagesForCustomer(
  customerId: ObjectId,
  phones: string[],
  limit = 500,
) {
  const messages = await getMessagesCollection();
  const safeLimit = Math.min(Math.max(limit, 1), 1000);
  return messages
    .find({
      $or: [{ customerId }, { contactPhone: { $in: phones } }],
    }, { projection: { _id: 0 } })
    .sort({ timestamp: 1 })
    .limit(safeLimit)
    .toArray();
}

export async function listWhatsAppMessagesForAssistant(
  customerId: ObjectId,
  after?: Date,
  limit = 40,
) {
  const messages = await getMessagesCollection();
  const safeLimit = Math.min(Math.max(limit, 1), 80);
  const results = await messages
    .find({
      customerId,
      ...(after ? { timestamp: { $gt: after } } : {}),
    })
    .sort({ timestamp: -1 })
    .limit(safeLimit)
    .toArray();

  return results.reverse();
}

export async function ensureWhatsAppMessageIndexes() {
  const messages = await getMessagesCollection();
  await Promise.all([
    messages.createIndex({ metaMessageId: 1 }, { unique: true }),
    messages.createIndex({ contactPhone: 1, timestamp: -1 }),
    messages.createIndex({ customerId: 1, timestamp: -1 }),
  ]);
}