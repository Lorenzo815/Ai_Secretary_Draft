import "server-only";

import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { getWhatsAppPhoneAliases, type CustomerDocument, type CustomerServiceStatus } from "../crm";
import {
  findLatestInboundWhatsAppMessage,
  findLatestWhatsAppMessage,
  listWhatsAppMessagesForCustomer,
  type WhatsAppMessageDocument,
} from "./messages";
import { getWhatsAppServiceWindowStatus } from "./service-window";

const DB_NAME = "ai_secretary";
const ACTIVE_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_HISTORY_MS = 30 * 24 * 60 * 60_000;

type InboxCustomer = Pick<CustomerDocument, "_id" | "name" | "phones" | "serviceStatus" | "whatsappAttention">;
type InboxMessage = Pick<
  WhatsAppMessageDocument,
  "_id" | "customerId" | "metaMessageId" | "contactPhone" | "direction" | "type" | "body" | "media" | "status" | "timestamp"
>;

export interface WhatsAppInboxConversation {
  customerId: string;
  customerName: string;
  phone: string;
  serviceStatus: CustomerServiceStatus;
  lastMessage: {
    messageId: string;
    direction: "inbound" | "outbound";
    type: string;
    preview: string;
    status: WhatsAppMessageDocument["status"];
    timestamp: string;
  };
  lastInboundAt: string;
  windowExpiresAt: string | null;
  withinServiceWindow: boolean;
  needsAttention: boolean;
  resolvedUntilNextMessage: boolean;
}

export interface WhatsAppInboxDetail {
  customerId: string;
  customerName: string;
  serviceStatus: CustomerServiceStatus;
  needsAttention: boolean;
  attentionMessageId: string | null;
  messages: Array<{
    messageId: string;
    direction: "inbound" | "outbound";
    type: string;
    templateName?: string;
    body: string;
    media?: {
      mimeType?: string;
      caption?: string;
      filename?: string;
      transcription?: string;
    };
    replyTo?: {
      body?: string;
      direction?: "inbound" | "outbound";
      type?: string;
    };
    status: WhatsAppMessageDocument["status"];
    sentBy?: string;
    timestamp: string;
  }>;
  availability: {
    canSendText: boolean;
    reason: string | null;
    expiresAt: string | null;
    recipientPhone: string | null;
  };
}

export class WhatsAppInboxConflictError extends Error {}

export interface WhatsAppInboxFilters {
  includeOutsideWindow?: boolean;
  startAt?: Date;
  endAt?: Date;
  now?: Date;
}

export async function listActiveWhatsAppInboxConversations(now = new Date()) {
  return listWhatsAppInboxConversations({ now });
}

export async function listWhatsAppInboxConversations(filters: WhatsAppInboxFilters = {}) {
  const now = filters.now ?? new Date();
  const includeOutsideWindow = filters.includeOutsideWindow ?? false;
  const database = (await clientPromise).db(DB_NAME);
  const messages = database.collection<InboxMessage>("whatsapp_messages");
  const cutoff = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const startAt = filters.startAt ?? new Date(now.getTime() - DEFAULT_HISTORY_MS);
  const endAt = filters.endAt ?? now;
  const candidateMessages = includeOutsideWindow
    ? (await messages.aggregate<{ latest: InboxMessage }>([
      {
        $match: {
          timestamp: { $gte: startAt, $lte: endAt },
          $or: [{ customerId: { $type: "objectId" } }, { contactPhone: { $type: "string" } }],
        },
      },
      { $sort: { timestamp: -1, _id: -1 } },
      { $group: { _id: { $ifNull: ["$customerId", "$contactPhone"] }, latest: { $first: "$$ROOT" } } },
    ]).toArray()).map(({ latest }) => latest)
    : await messages.find({
      direction: "inbound",
      timestamp: { $gt: cutoff },
      $or: [{ customerId: { $type: "objectId" } }, { contactPhone: { $type: "string" } }],
    },
    {
      projection: {
        _id: 1,
        customerId: 1,
        metaMessageId: 1,
        contactPhone: 1,
        direction: 1,
        type: 1,
        body: 1,
        media: 1,
        status: 1,
        timestamp: 1,
      },
    }).sort({ timestamp: -1, _id: -1 }).toArray();
  if (candidateMessages.length === 0) return [];

  const customerIds = [...new Set(candidateMessages.flatMap((message) => (
    message.customerId ? [message.customerId.toString()] : []
  )))].map((id) => new ObjectId(id));
  const phones = [...new Set(candidateMessages.flatMap((message) => (
    message.contactPhone ? getWhatsAppPhoneAliases(message.contactPhone) : []
  )))];
  const customers = await database.collection<InboxCustomer>("crm_customers").find(
    {
      $or: [
        ...(customerIds.length > 0 ? [{ _id: { $in: customerIds } }] : []),
        ...(phones.length > 0 ? [{ phones: { $in: phones } }] : []),
      ],
    },
    { projection: { name: 1, phones: 1, serviceStatus: 1, whatsappAttention: 1 } },
  ).toArray();
  const customerById = new Map(customers.map((customer) => [customer._id.toString(), customer]));
  const customerByPhone = new Map(customers.flatMap((customer) => (
    customer.phones.flatMap((phone) => getWhatsAppPhoneAliases(phone).map((alias) => [alias, customer] as const))
  )));
  const includedCustomers = new Map<string, { customer: InboxCustomer; candidate: InboxMessage }>();
  for (const message of candidateMessages) {
    const customer = (message.customerId ? customerById.get(message.customerId.toString()) : undefined)
      ?? customerByPhone.get(message.contactPhone);
    if (!customer) continue;
    const key = customer._id.toString();
    const current = includedCustomers.get(key);
    if (!current || compareMessages(message, current.candidate) > 0) {
      includedCustomers.set(key, { customer, candidate: message });
    }
  }
  if (includedCustomers.size === 0) return [];

  const includedIds = [...includedCustomers.values()].map(({ customer }) => customer._id);
  const includedPhones = [...new Set([...includedCustomers.values()].flatMap(({ customer }) => (
    customer.phones.flatMap(getWhatsAppPhoneAliases)
  )))];
  const relatedMessageMatch = {
    $or: [
      { customerId: { $in: includedIds } },
      { contactPhone: { $in: includedPhones } },
    ],
  };
  const latestGroups = includeOutsideWindow ? [] : await messages.aggregate<{ latest: InboxMessage }>([
    {
      $match: relatedMessageMatch,
    },
    { $sort: { timestamp: -1, _id: -1 } },
    { $group: { _id: { $ifNull: ["$customerId", "$contactPhone"] }, latest: { $first: "$$ROOT" } } },
  ]).toArray();
  const latestByCustomer = new Map<string, InboxMessage>();
  for (const latest of includeOutsideWindow
    ? [...includedCustomers.values()].map(({ candidate }) => candidate)
    : latestGroups.map((group) => group.latest)) {
    const customer = (latest.customerId ? customerById.get(latest.customerId.toString()) : undefined)
      ?? customerByPhone.get(latest.contactPhone);
    if (!customer) continue;
    const key = customer._id.toString();
    const current = latestByCustomer.get(key);
    if (!current || compareMessages(latest, current) > 0) latestByCustomer.set(key, latest);
  }

  const lastInboundByCustomer = new Map<string, InboxMessage>();
  if (includeOutsideWindow) {
    const lastInboundGroups = await messages.aggregate<{ latest: InboxMessage }>([
      { $match: { ...relatedMessageMatch, direction: "inbound" } },
      { $sort: { timestamp: -1, _id: -1 } },
      { $group: { _id: { $ifNull: ["$customerId", "$contactPhone"] }, latest: { $first: "$$ROOT" } } },
    ]).toArray();
    for (const { latest } of lastInboundGroups) {
      const customer = (latest.customerId ? customerById.get(latest.customerId.toString()) : undefined)
        ?? customerByPhone.get(latest.contactPhone);
      if (!customer) continue;
      const key = customer._id.toString();
      const current = lastInboundByCustomer.get(key);
      if (!current || compareMessages(latest, current) > 0) lastInboundByCustomer.set(key, latest);
    }
  }

  return [...includedCustomers.values()].flatMap(({ customer, candidate }) => {
    const latest = latestByCustomer.get(customer._id.toString()) ?? candidate;
    const lastInbound = includeOutsideWindow
      ? lastInboundByCustomer.get(customer._id.toString())
      : candidate;
    const availability = getWhatsAppServiceWindowStatus(lastInbound?.timestamp ?? null, now);
    if (!includeOutsideWindow && (!availability.canSendText || !availability.expiresAt)) return [];
    const resolved = latest.direction === "inbound"
      && customer.whatsappAttention?.resolvedThroughMessageId === latest.metaMessageId;
    return [{
      customerId: customer._id.toString(),
      customerName: customer.name,
      phone: customer.phones[0] ?? latest.contactPhone,
      serviceStatus: customer.serviceStatus ?? "ai_active",
      lastMessage: {
        messageId: latest.metaMessageId,
        direction: latest.direction,
        type: latest.type,
        preview: messagePreview(latest),
        status: latest.status,
        timestamp: latest.timestamp.toISOString(),
      },
      lastInboundAt: lastInbound?.timestamp.toISOString() ?? "",
      windowExpiresAt: availability.expiresAt?.toISOString() ?? null,
      withinServiceWindow: availability.canSendText,
      needsAttention: latest.direction === "inbound" && !resolved,
      resolvedUntilNextMessage: resolved,
    }];
  }).sort((left, right) => (
    Date.parse(right.lastMessage.timestamp) - Date.parse(left.lastMessage.timestamp)
  ));
}

export async function getWhatsAppInboxDetail(customerId: ObjectId): Promise<WhatsAppInboxDetail> {
  const database = (await clientPromise).db(DB_NAME);
  const customer = await database.collection<InboxCustomer>("crm_customers").findOne(
    { _id: customerId },
    { projection: { name: 1, phones: 1, serviceStatus: 1, whatsappAttention: 1 } },
  );
  if (!customer) throw new Error("Cliente não encontrado.");
  const [messages, lastInbound] = await Promise.all([
    listWhatsAppMessagesForCustomer(customer._id, customer.phones),
    findLatestInboundWhatsAppMessage(customer._id, customer.phones),
  ]);
  const latest = messages.at(-1);
  const availability = getWhatsAppServiceWindowStatus(lastInbound?.timestamp ?? null);
  const resolved = latest?.direction === "inbound"
    && customer.whatsappAttention?.resolvedThroughMessageId === latest.metaMessageId;
  return {
    customerId: customer._id.toString(),
    customerName: customer.name,
    serviceStatus: customer.serviceStatus ?? "ai_active",
    needsAttention: latest?.direction === "inbound" && !resolved,
    attentionMessageId: latest?.direction === "inbound" ? latest.metaMessageId : null,
    messages: messages.map((message) => ({
      messageId: message.metaMessageId,
      direction: message.direction,
      type: message.type,
      templateName: message.templateName,
      body: message.body,
      media: message.media ? {
        mimeType: message.media.mimeType,
        caption: message.media.caption,
        filename: message.media.filename,
        transcription: message.media.transcription,
      } : undefined,
      replyTo: message.replyTo,
      status: message.status,
      sentBy: message.sentBy,
      timestamp: message.timestamp.toISOString(),
    })),
    availability: {
      ...availability,
      expiresAt: availability.expiresAt?.toISOString() ?? null,
      recipientPhone: customer.phones[0] ?? lastInbound?.contactPhone ?? null,
    },
  };
}

export async function resolveWhatsAppInboxAttention(
  customerId: ObjectId,
  expectedMessageId: string,
  resolvedBy: string,
) {
  const database = (await clientPromise).db(DB_NAME);
  const customer = await database.collection<InboxCustomer>("crm_customers").findOne(
    { _id: customerId },
    { projection: { phones: 1 } },
  );
  if (!customer) throw new Error("Cliente não encontrado.");
  const latest = await findLatestWhatsAppMessage(customer._id, customer.phones);
  if (!latest || latest.direction !== "inbound" || latest.metaMessageId !== expectedMessageId) {
    throw new WhatsAppInboxConflictError("Uma mensagem mais recente alterou a conversa. Revise o chat antes de resolver.");
  }
  await database.collection("crm_customers").updateOne(
    { _id: customer._id },
    {
      $set: {
        whatsappAttention: {
          resolvedThroughMessageId: latest.metaMessageId,
          resolvedAt: new Date(),
          resolvedBy,
        },
        updatedAt: new Date(),
      },
    },
  );
}

function compareMessages(left: InboxMessage, right: InboxMessage) {
  const timestampDifference = left.timestamp.getTime() - right.timestamp.getTime();
  return timestampDifference || left._id.toString().localeCompare(right._id.toString());
}

function messagePreview(message: InboxMessage) {
  const body = message.body.trim();
  if (body && body !== `[${message.type}]` && body !== message.media?.filename) return body.slice(0, 160);
  if (message.type === "image") return "Imagem";
  if (message.type === "audio") return message.media?.transcription?.slice(0, 160) || "Áudio";
  if (message.type === "video") return "Vídeo";
  if (message.type === "document") return message.media?.filename || "Documento";
  if (message.type === "template") return "Modelo de mensagem";
  return "Mensagem";
}
