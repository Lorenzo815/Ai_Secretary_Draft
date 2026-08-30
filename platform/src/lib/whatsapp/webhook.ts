import "server-only";

import {
  ensureWhatsAppMessageIndexes,
  MessageStatus,
  saveWhatsAppMessage,
  updateWhatsAppMessageStatus,
} from "./messages";

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

interface WebhookValue {
  contacts?: Array<{ profile?: { name?: string } }>;
  messages?: WebhookMessage[];
  statuses?: Array<{ id?: string; status?: string }>;
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: WebhookValue }> }>;
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

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== "messages" || !value) continue;
      const contact = value.contacts?.[0];

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        await saveWhatsAppMessage({
          metaMessageId: message.id,
          contactPhone: message.from,
          contactName: contact?.profile?.name,
          direction: "inbound",
          type: message.type ?? "unknown",
          body: getMessageBody(message),
          status: "received",
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
        });
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

  return { receivedMessages, statusUpdates };
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