import "server-only";

import { ObjectId } from "mongodb";
import { getMongoClient } from "../mongodb";
import { legacyCompanyId } from "../companies/ownership";
import { findOrCreateCustomerFromWhatsApp } from "../crm/customers";
import { getWhatsAppPhoneAliases } from "../crm/validation";
import { coexistenceWebhookEventId } from "./embedded-signup";
import { resolveWhatsAppCompany, type WhatsAppCompanyBinding } from "./company-routing";
import { getMessageBody, getMessageMedia, type WebhookMessage } from "./message-payload";
import { findWhatsAppMessageByMetaId, saveWhatsAppMessageEcho } from "./messages";

interface EchoValue extends Record<string, unknown> {
  metadata?: { phone_number_id?: string };
  message_echoes?: WebhookMessage[];
}

interface EchoEvent {
  _id: string;
  companyId: ObjectId;
  wabaId: string;
  field: string;
  value: EchoValue;
  receivedAt: Date;
  processedAt: Date | null;
  processingError?: string;
  nextAttemptAt?: Date;
}

async function database() {
  return (await getMongoClient()).db("ai_secretary");
}

export async function processWhatsAppMessageEchoes(input: { wabaId: string; value: EchoValue }) {
  const db = await database();
  const phoneNumberId = input.value.metadata?.phone_number_id;
  if (!phoneNumberId || !Array.isArray(input.value.message_echoes)) {
    throw new Error("WHATSAPP_ECHO_INVALID_PAYLOAD");
  }
  const bindings = await db.collection<WhatsAppCompanyBinding>("whatsapp_embedded_signup_connections").find({
    wabaId: input.wabaId, status: { $in: ["operational", "connected"] },
  }, { projection: { companyId: 1, wabaId: 1, phoneNumberId: 1, status: 1 } }).toArray();
  const companyId = resolveWhatsAppCompany({
    object: "whatsapp_business_account",
    entry: [{ id: input.wabaId, changes: [{ field: "smb_message_echoes", value: input.value }] }],
  }, bindings);
  // Operational reads remain restricted to the initial company until tenant isolation is complete.
  if (!companyId.equals(legacyCompanyId()) ||
    !await db.collection("companies").findOne({ _id: companyId, status: "active" })) {
    throw new Error("WHATSAPP_ECHO_COMPANY_NOT_OPERATIONAL");
  }

  for (const echo of input.value.message_echoes) {
    const timestamp = new Date(Number(echo.timestamp) * 1000);
    if (!echo.id || !echo.to || !/^\d{5,15}$/.test(echo.to) || !echo.type ||
      !echo.timestamp || !Number.isFinite(timestamp.getTime()) || timestamp.getTime() <= 0) {
      throw new Error("WHATSAPP_ECHO_INVALID_MESSAGE");
    }
    const change = echo.type === "edit" || echo.type === "revoke" ? echo.type : undefined;
    const targetId = change === "edit" ? echo.edit?.original_message_id
      : change === "revoke" ? echo.revoke?.original_message_id : undefined;
    const content = change === "edit" ? echo.edit?.message : echo;
    if (change && (!targetId || (change === "edit" && !content?.type))) {
      throw new Error("WHATSAPP_ECHO_INVALID_CHANGE");
    }
    const customer = await findOrCreateCustomerFromWhatsApp({
      phone: echo.to, interactionAt: timestamp, companyId,
    });
    const media = content ? getMessageMedia(content) : null;
    const referenced = content?.context?.id
      ? await findWhatsAppMessageByMetaId(content.context.id, companyId)
      : null;
    await saveWhatsAppMessageEcho({
      customerId: customer._id,
      metaMessageId: targetId ?? echo.id,
      contactPhone: echo.to,
      direction: "outbound",
      type: change === "revoke" ? "revoked" : content?.type ?? echo.type,
      body: change === "revoke" ? "Mensagem removida no WhatsApp." : getMessageBody(content ?? echo),
      ...(media ? { media } : {}),
      ...(content?.context?.id ? {
        replyTo: {
          metaMessageId: content.context.id,
          ...(referenced ? { body: referenced.body, direction: referenced.direction, type: referenced.type } : {}),
        },
      } : {}),
      status: "sent",
      source: "whatsapp_business_app",
      externalActivity: { messageId: echo.id, timestamp },
      timestamp,
    }, change);
  }
  await db.collection<EchoEvent>("whatsapp_coexistence_webhook_events").updateOne({
    _id: coexistenceWebhookEventId({ ...input, field: "smb_message_echoes" }),
    companyId,
    field: "smb_message_echoes",
  }, { $set: { processedAt: new Date() }, $unset: { processingError: "", nextAttemptAt: "" } });
}

export async function processPendingWhatsAppMessageEchoes(phones?: string[]) {
  const db = await database();
  const events = db.collection<EchoEvent>("whatsapp_coexistence_webhook_events");
  const filter = {
    companyId: legacyCompanyId(), field: "smb_message_echoes", processedAt: null,
    ...(phones ? { "value.message_echoes.to": { $in: [...new Set(phones.flatMap(getWhatsAppPhoneAliases))] } } : {}),
  };
  await events.createIndex({ companyId: 1, field: 1, processedAt: 1, nextAttemptAt: 1, receivedAt: 1 });
  const pending = await events.find({
    ...filter,
    $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: new Date() } }],
  }).sort({ nextAttemptAt: 1, receivedAt: 1, _id: 1 }).limit(100).toArray();
  let processed = 0;
  let failed = 0;
  for (const event of pending) {
    try {
      await processWhatsAppMessageEchoes(event);
      processed += 1;
    } catch (error) {
      failed += 1;
      const errorType = error instanceof Error ? error.name : "Unknown";
      const code = error instanceof Error && /^WHATSAPP_(ECHO|FORWARDING)_[A-Z_]+$/.test(error.message)
        ? error.message : errorType;
      console.error("WhatsApp echo could not be synchronized.", { eventId: event._id, errorType, code });
      await events.updateOne({ _id: event._id, companyId: legacyCompanyId() }, {
        $set: { processingError: code, nextAttemptAt: new Date(Date.now() + 60_000) },
      });
    }
  }
  return { processed, failed, pending: Boolean(await events.findOne(filter, { projection: { _id: 1 } })) };
}
