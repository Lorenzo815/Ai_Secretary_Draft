import "server-only";

import { createHash } from "node:crypto";
import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { legacyCompanyId, withLegacyCompany } from "../companies/ownership";

export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "received" | "sent" | "delivered" | "read" | "failed";

export interface WhatsAppMediaReference {
  id: string;
  mimeType?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  dataUrl?: string;
  transcription?: string;
}

export interface WhatsAppReplyReference {
  metaMessageId: string;
  body?: string;
  direction?: MessageDirection;
  type?: string;
}

export interface WhatsAppMessageDocument {
  _id: ObjectId;
  customerId?: ObjectId;
  metaMessageId: string;
  contactPhone: string;
  contactName?: string;
  direction: MessageDirection;
  type: string;
  body: string;
  media?: WhatsAppMediaReference;
  replyTo?: WhatsAppReplyReference;
  templateName?: string;
  status: MessageStatus;
  sentBy?: string;
  source?: "whatsapp_business_app";
  externalActivity?: { messageId: string; timestamp: Date };
  externalOriginalPending?: boolean;
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
      $setOnInsert: withLegacyCompany({ _id: new ObjectId() }),
    },
    { upsert: true },
  );

  return { inserted: result.upsertedCount === 1 };
}

export async function saveWhatsAppMessageEcho(
  message: Omit<WhatsAppMessageDocument, "_id" | "updatedAt"> & {
    customerId: ObjectId;
    source: "whatsapp_business_app";
    externalActivity: { messageId: string; timestamp: Date };
  },
  change?: "edit" | "revoke",
) {
  const messages = await getMessagesCollection();
  const filter = {
    companyId: legacyCompanyId(), metaMessageId: message.metaMessageId,
    customerId: message.customerId, direction: "outbound" as const,
  };
  const now = new Date();
  const result = await messages.updateOne(filter, {
    $setOnInsert: withLegacyCompany({
      ...message,
      _id: new ObjectId(),
      updatedAt: now,
      ...(change ? { externalOriginalPending: true } : {}),
    }),
  }, { upsert: true });

  if (!change) {
    // An edit/revoke can arrive before its original message.
    await messages.updateOne({ ...filter, externalOriginalPending: true }, {
      $set: { timestamp: message.timestamp },
      $unset: { externalOriginalPending: "" },
    });
    return { inserted: result.upsertedCount === 1 };
  }
  const activity = message.externalActivity;
  if (change === "revoke") {
    await messages.updateOne({ ...filter, type: { $ne: "revoked" } }, {
      $set: {
        body: message.body,
        type: "revoked",
        source: "whatsapp_business_app",
        "externalActivity.messageId": activity.messageId,
        updatedAt: now,
      },
      $max: { "externalActivity.timestamp": activity.timestamp },
      $unset: { media: "", replyTo: "" },
    });
    return { inserted: result.upsertedCount === 1 };
  }
  await messages.updateOne({
    ...filter,
    customerId: message.customerId,
    direction: "outbound",
    type: { $ne: "revoked" },
    $or: [
      { externalActivity: { $exists: false } },
      { "externalActivity.timestamp": { $lt: activity.timestamp } },
      { "externalActivity.timestamp": activity.timestamp, "externalActivity.messageId": { $lt: activity.messageId } },
    ],
  }, {
    $set: {
      body: message.body,
      type: message.type,
      source: "whatsapp_business_app",
      externalActivity: activity,
      updatedAt: now,
      ...(message.media ? { media: message.media } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    },
    $unset: {
      ...(!message.media ? { media: "" } : {}),
      ...(!message.replyTo ? { replyTo: "" } : {}),
    },
  });
  return { inserted: result.upsertedCount === 1 };
}

export async function getWhatsAppExternalActivityState(customerId: ObjectId) {
  const activities = await (await getMessagesCollection()).find({
    companyId: legacyCompanyId(), customerId, source: "whatsapp_business_app",
  }, { projection: { _id: 1, externalActivity: 1, timestamp: 1 } }).sort({ _id: 1 }).toArray();
  let latestAt: Date | null = null;
  for (const message of activities) {
    const timestamp = message.externalActivity?.timestamp;
    if (timestamp && (!latestAt || timestamp > latestAt)) latestAt = timestamp;
  }
  return {
    version: createHash("sha256").update(JSON.stringify(activities)).digest("hex"),
    latestAt,
  };
}

export async function updateWhatsAppMessageStatus(metaMessageId: string, status: MessageStatus) {
  const messages = await getMessagesCollection();
  await messages.updateOne(
    { metaMessageId },
    { $set: { status, updatedAt: new Date() } },
  );
}

export async function updateWhatsAppMediaTranscription(metaMessageId: string, transcription: string) {
  await (await getMessagesCollection()).updateOne(
    { metaMessageId, "media.id": { $exists: true } },
    {
      $set: {
        "media.transcription": transcription.slice(0, 20_000),
        updatedAt: new Date(),
      },
    },
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
    .sort({ timestamp: 1, _id: 1 })
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
    .sort({ timestamp: -1, _id: -1 })
    .limit(safeLimit)
    .toArray();

  return results.reverse();
}

export async function findLatestInboundWhatsAppMessage(customerId: ObjectId, phones: string[]) {
  const normalizedPhones = phones.map((phone) => phone.replace(/\D/g, "")).filter(Boolean);
  return (await getMessagesCollection()).findOne(
    {
      direction: "inbound",
      $or: [
        { customerId },
        ...(normalizedPhones.length > 0 ? [{ contactPhone: { $in: normalizedPhones } }] : []),
      ],
    },
    { sort: { timestamp: -1, _id: -1 } },
  );
}

export async function findLatestWhatsAppMessage(customerId: ObjectId, phones: string[]) {
  const normalizedPhones = phones.map((phone) => phone.replace(/\D/g, "")).filter(Boolean);
  return (await getMessagesCollection()).findOne(
    {
      $or: [
        { customerId },
        ...(normalizedPhones.length > 0 ? [{ contactPhone: { $in: normalizedPhones } }] : []),
      ],
    },
    { sort: { timestamp: -1, _id: -1 } },
  );
}

export async function isLatestInboundWhatsAppMessage(customerId: ObjectId, messageId: ObjectId) {
  const latest = await (await getMessagesCollection()).findOne(
    { customerId, direction: "inbound" },
    { projection: { _id: 1 }, sort: { timestamp: -1, _id: -1 } },
  );
  return latest?._id.equals(messageId) ?? false;
}

export async function ensureWhatsAppMessageIndexes() {
  const messages = await getMessagesCollection();
  await Promise.all([
    messages.createIndex({ metaMessageId: 1 }, { unique: true }),
    messages.createIndex({ contactPhone: 1, timestamp: -1 }),
    messages.createIndex({ customerId: 1, timestamp: -1 }),
    messages.createIndex({ customerId: 1, direction: 1, timestamp: -1 }),
    messages.createIndex({ direction: 1, timestamp: -1, customerId: 1 }),
    messages.createIndex({ timestamp: -1 }),
  ]);
}

export async function findWhatsAppMessageByMetaId(metaMessageId: string, companyId?: ObjectId) {
  return (await getMessagesCollection()).findOne({ metaMessageId, ...(companyId ? { companyId } : {}) });
}