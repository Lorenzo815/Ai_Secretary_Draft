export interface WebhookMessage {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  context?: { id?: string; from?: string };
  image?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; sha256?: string; voice?: boolean };
  video?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  document?: { id?: string; mime_type?: string; sha256?: string; caption?: string; filename?: string };
  reaction?: { emoji?: string };
  edit?: { original_message_id?: string; message?: WebhookMessage };
  revoke?: { original_message_id?: string };
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
