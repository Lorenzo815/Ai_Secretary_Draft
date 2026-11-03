import "server-only";

import type { ObjectId } from "mongodb";
import { cancelAutomationJob, emitAutomationEvent } from "../automation";
import { runWithCompany } from "../companies/context";
import { isCompanyOperational } from "../companies/status";
import { findOrCreateCustomerFromWhatsApp } from "../crm";
import {
  ensureWhatsAppMessageIndexes,
  MessageStatus,
  findWhatsAppMessageByMetaId,
  saveWhatsAppMessage,
  updateWhatsAppMessageStatus,
} from "./messages";
import {
  captureCoexistenceWebhookEvent,
  COEXISTENCE_WEBHOOK_FIELDS,
  resolveCompanyForPhoneNumber,
} from "./embedded-signup";
import { getMessageBody, getMessageMedia, getMessageReferral, getMessageSelection, type WebhookMessage } from "./message-payload";
import { processWhatsAppMessageEchoes } from "./message-echoes";
import { handleConfirmationButton } from "../confirmations/service";
import { hydrateWhatsAppTemplateContext } from "./template-context";

interface WebhookValue extends Record<string, unknown> {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string } }>;
  messages?: WebhookMessage[];
  statuses?: Array<{ id?: string; status?: string }>;
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WebhookValue }> }>;
}

const validStatuses = new Set<MessageStatus>(["sent", "delivered", "read", "failed"]);

export class WhatsAppWebhookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function processWhatsAppWebhook(rawBody: string) {
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    throw new WhatsAppWebhookError("JSON inválido.", 400);
  }

  if (payload.object !== "whatsapp_business_account") {
    throw new WhatsAppWebhookError("Evento não suportado.", 400);
  }

  await ensureWhatsAppMessageIndexes();
  let receivedMessages = 0;
  let statusUpdates = 0;
  let coexistenceEvents = 0;
  const processingCustomers = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field && value && COEXISTENCE_WEBHOOK_FIELDS.has(change.field)) {
        if (await captureCoexistenceWebhookEvent({
          wabaId: entry.id ?? "unknown",
          field: change.field,
          value,
        })) coexistenceEvents += 1;
      }
      if (change.field === "smb_message_echoes" && value) {
        await processWhatsAppMessageEchoes({ wabaId: entry.id ?? "unknown", value });
      }
      if (change.field !== "messages" || !value) continue;
      const companyId = await resolveCompanyForPhoneNumber(value.metadata?.phone_number_id);
      if (!companyId || !await isCompanyOperational(companyId)) continue;
      const counts = await runWithCompany(companyId, () => processMessagesChange(companyId, entry.id ?? "", value, processingCustomers));
      receivedMessages += counts.receivedMessages;
      statusUpdates += counts.statusUpdates;
    }
  }

  return {
    receivedMessages,
    statusUpdates,
    coexistenceEvents,
    processingRequests: processingCustomers.size,
  };
}

async function processMessagesChange(
  companyId: ObjectId,
  wabaId: string,
  value: WebhookValue,
  processingCustomers: Set<string>,
) {
  let receivedMessages = 0;
  let statusUpdates = 0;
  const contact = value.contacts?.[0];

  for (const message of value.messages ?? []) {
    if (!message.id || !message.from) continue;
    const referral = getMessageReferral(message);
    const template = message.type === "template"
      ? await hydrateWhatsAppTemplateContext(companyId, wabaId, message.template)
      : null;
    const timestamp = message.timestamp
      ? new Date(Number(message.timestamp) * 1000)
      : new Date();
    const customer = await findOrCreateCustomerFromWhatsApp({
      phone: message.from,
      name: contact?.profile?.name,
      interactionAt: timestamp,
      companyId,
    });
    const referenced = message.context?.id
      ? await findWhatsAppMessageByMetaId(message.context.id, companyId)
      : null;
    const media = getMessageMedia(message);
    const selection = getMessageSelection(message);
    const saved = await saveWhatsAppMessage({
      customerId: customer._id,
      metaMessageId: message.id,
      contactPhone: message.from,
      contactName: contact?.profile?.name,
      direction: "inbound",
      type: message.type ?? "unknown",
      body: template?.body ?? getMessageBody(message),
      ...(template ? { templateName: template.templateName, templateLanguage: template.templateLanguage } : {}),
      ...(selection ? { selection } : {}),
      ...(referral ? { referral } : {}),
      ...(media ? { media } : {}),
      ...(message.context?.id ? {
        replyTo: {
          metaMessageId: message.context.id,
          ...(referenced ? {
            body: referenced.body,
            direction: referenced.direction,
            type: referenced.type,
          } : {}),
        },
      } : {}),
      status: "received",
      timestamp,
    });
    // Taps on the appointment confirmation reminder buttons are answered without the AI, except
    // "Escolher novo horário", which hands the conversation to the AI.
    const confirmation = saved.inserted && selection?.type === "button" && selection.payload
      ? await handleConfirmationButton({ customer, payload: selection.payload })
      : { handled: false as const };
    if (confirmation.handled && !confirmation.runAgent) {
      await cancelAutomationJob("customer_follow_up", customer._id);
    } else if (saved.inserted && (confirmation.handled || !customer.serviceStatus || customer.serviceStatus === "ai_active")) {
      await cancelAutomationJob("customer_follow_up", customer._id);
      const processes = await emitAutomationEvent({
        type: "message.received",
        customerId: customer._id,
        occurredAt: timestamp,
      }, { immediate: true });
      if (processes.includes("customer_agent")) processingCustomers.add(customer._id.toString());
    }
    receivedMessages += 1;
  }

  for (const event of value.statuses ?? []) {
    if (event.id && event.status && validStatuses.has(event.status as MessageStatus)) {
      await updateWhatsAppMessageStatus(event.id, event.status as MessageStatus);
      statusUpdates += 1;
    }
  }
  return { receivedMessages, statusUpdates };
}