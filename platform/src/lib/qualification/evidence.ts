import type { LeadInsightEvidenceReference } from "./contracts";

export interface QualificationEvidenceMessage {
  messageId: string;
  text: string;
}

export function assertInsightTagEvidence(
  tags: Array<{ label: string; evidence: LeadInsightEvidenceReference[] }>,
  messages: QualificationEvidenceMessage[],
) {
  const messagesById = new Map(messages.map((message) => [message.messageId, message.text]));

  for (const tag of tags) {
    if (tag.evidence.length === 0) {
      throw new Error(`A tag "${tag.label}" não possui evidência verificável.`);
    }
    for (const reference of tag.evidence) {
      const message = messagesById.get(reference.messageId);
      if (!message) {
        throw new Error(`A tag "${tag.label}" referencia uma mensagem inexistente.`);
      }
      if (!normalizeWhitespace(message).includes(normalizeWhitespace(reference.excerpt))) {
        throw new Error(`A evidência da tag "${tag.label}" não corresponde à mensagem indicada.`);
      }
    }
  }
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}