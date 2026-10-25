import "server-only";

import { cancelAutomationJob, emitAutomationEvent } from "../automation";
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
  isOperationalEmbeddedSignupPhoneNumber,
} from "./embedded-signup";
import { getMessageBody, getMessageMedia, getMessageSelection, type WebhookMessage } from "./message-payload";
import { processWhatsAppMessageEchoes } from "./message-echoes";
import { hydrateWhatsAppTemplateContext } from "./template-context";
import { legacyCompanyId } from "../companies/ownership";

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
      const embeddedConnectionMatch = await isOperationalEmbeddedSignupPhoneNumber(value.metadata?.phone_number_id);
      if (embeddedConnectionMatch === false) continue;
      if (embeddedConnectionMatch === null) {
        const legacyPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (legacyPhoneNumberId && value.metadata?.phone_number_id !== legacyPhoneNumberId) continue;
      }
      const contact = value.contacts?.[0];

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        const template = message.type === "template"
          ? await hydrateWhatsAppTemplateContext(legacyCompanyId(), entry.id ?? "", message.template)
          : null;
        const timestamp = message.timestamp
          ? new Date(Number(message.timestamp) * 1000)
          : new Date();
        const customer = await findOrCreateCustomerFromWhatsApp({
          phone: message.from,
          name: contact?.profile?.name,
          interactionAt: timestamp,
        });
        const referenced = message.context?.id
          ? await findWhatsAppMessageByMetaId(message.context.id, legacyCompanyId())
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
        if (saved.inserted && (!customer.serviceStatus || customer.serviceStatus === "ai_active")) {
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
    }
  }

  return {
    receivedMessages,
    statusUpdates,
    coexistenceEvents,
    processingRequests: processingCustomers.size,
  };
}