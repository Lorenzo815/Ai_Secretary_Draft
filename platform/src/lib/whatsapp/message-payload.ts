export interface WebhookMessage {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string; id?: string }; list_reply?: { title?: string; id?: string } };
  template?: WhatsAppTemplatePayload;
  context?: { id?: string; from?: string };
  image?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; sha256?: string; voice?: boolean };
  video?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  document?: { id?: string; mime_type?: string; sha256?: string; caption?: string; filename?: string };
  reaction?: { emoji?: string };
  edit?: { original_message_id?: string; message?: WebhookMessage };
  revoke?: { original_message_id?: string };
}

export function getMessageSelection(message: WebhookMessage) {
  if (message.button?.text) return {
    type: "button" as const, title: message.button.text,
    ...(message.button.payload !== undefined ? { payload: message.button.payload } : {}),
  };
  const button = message.interactive?.button_reply;
  if (button?.title) return {
    type: "button_reply" as const, title: button.title, ...(button.id !== undefined ? { id: button.id } : {}),
  };
  const list = message.interactive?.list_reply;
  if (list?.title) return {
    type: "list_reply" as const, title: list.title, ...(list.id !== undefined ? { id: list.id } : {}),
  };
  return null;
}

export function getMessageBody(message: WebhookMessage) {
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

export function getMessageMedia(message: WebhookMessage) {
  const media = message.image ?? message.audio ?? message.video ?? message.document;
  if (!media?.id) return null;
  return {
    id: media.id,
    ...(media.mime_type ? { mimeType: media.mime_type } : {}),
    ...(media.sha256 ? { sha256: media.sha256 } : {}),
    ...("caption" in media && media.caption ? { caption: media.caption } : {}),
    ...(message.document?.filename ? { filename: message.document.filename } : {}),
  };
}
import type { WhatsAppTemplatePayload } from "./template-context";
