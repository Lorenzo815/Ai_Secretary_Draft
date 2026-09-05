import "server-only";

import { emitAutomationEvent } from "../automation";
import { findOrCreateCustomerFromWhatsApp } from "../crm";
import {
  ensureWhatsAppMessageIndexes,
  MessageStatus,
  saveWhatsAppMessage,
  updateWhatsAppMessageStatus,
} from "./messages";
import {
  captureCoexistenceWebhookEvent,
  COEXISTENCE_WEBHOOK_FIELDS,
  isOperationalEmbeddedSignupPhoneNumber,
} from "./embedded-signup";

interface WebhookMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  reaction?: { emoji?: string };
}

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
      if (change.field !== "messages" || !value) continue;
      const embeddedConnectionMatch = await isOperationalEmbeddedSignupPhoneNumber(value.metadata?.phone_number_id);
      if (embeddedConnectionMatch === false) continue;
      if (embeddedConnectionMatch === null) {
        const legacyPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (legacyPhoneNumberId && value.metadata?.phone_number_id !== legacyPhoneNumberId) continue;
      }
      const contact = value.contacts?.[0];

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        const timestamp = message.timestamp
          ? new Date(Number(message.timestamp) * 1000)
          : new Date();
        const customer = await findOrCreateCustomerFromWhatsApp({
          phone: message.from,
          name: contact?.profile?.name,
          interactionAt: timestamp,
        });
        const saved = await saveWhatsAppMessage({
          customerId: customer._id,
          metaMessageId: message.id,
          contactPhone: message.from,
          contactName: contact?.profile?.name,
          direction: "inbound",
          type: message.type ?? "unknown",
          body: getMessageBody(message),
          status: "received",
          timestamp,
        });
        if (saved.inserted && (!customer.serviceStatus || customer.serviceStatus === "ai_active")) {
          await emitAutomationEvent({
            type: "message.received",
            customerId: customer._id,
            occurredAt: timestamp,
          });
        }
        receivedMessages += 1;
      }

      for (const event of value.statuses ?? []) {
        if (event.id && event.status && validStatuses.has(event.status as MessageStatus)) {
          await updateWhatsAppMessageStatus(event.id, event.status as MessageStatus);
          statusUpdates += 1;
        }
      }
    }
  }

  return { receivedMessages, statusUpdates, coexistenceEvents };
}

function getMessageBody(message: WebhookMessage) {
  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.image?.caption ??
    message.video?.caption ??
    message.document?.caption ??
    message.document?.filename ??
    message.reaction?.emoji ??
    `[${message.type ?? "mensagem"}]`
  );
}