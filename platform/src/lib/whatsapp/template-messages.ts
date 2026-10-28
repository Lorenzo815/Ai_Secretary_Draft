import "server-only";

import type { CustomerDocument } from "../crm/customers";
import { sendWhatsAppTemplate } from "./client";
import { saveWhatsAppMessage } from "./messages";
import type { WhatsAppTemplate, WhatsAppTemplateSendParameters } from "./templates";

export class WhatsAppTemplatePersistenceError extends Error {
  constructor(readonly messageId: string, cause: unknown) {
    super("A Meta aceitou o envio, mas não foi possível salvar o histórico. Não repita o envio automaticamente.", { cause });
    this.name = "WhatsAppTemplatePersistenceError";
  }
}

export async function sendAndStoreCustomerTemplate(input: {
  customer: Pick<CustomerDocument, "_id" | "name">;
  to: string;
  template: WhatsAppTemplate;
  parameters: WhatsAppTemplateSendParameters;
  body: string;
  sentBy?: string;
}) {
  const sent = await sendWhatsAppTemplate({
    to: input.to,
    name: input.template.name,
    language: input.template.language,
    headerParameters: input.parameters.header,
    bodyParameters: input.parameters.body,
    buttonUrlParameters: input.parameters.buttonUrls,
  });
  const timestamp = new Date();
  try {
    await saveWhatsAppMessage({
      customerId: input.customer._id,
      metaMessageId: sent.messageId,
      contactPhone: sent.to,
      contactName: input.customer.name,
      direction: "outbound",
      type: "template",
      body: input.body,
      templateName: input.template.name,
      templateLanguage: input.template.language,
      status: "sent",
      ...(input.sentBy ? { sentBy: input.sentBy } : {}),
      timestamp,
    });
  } catch (error) {
    console.error("WhatsApp template was accepted by Meta but could not be persisted.", {
      messageId: sent.messageId,
      errorType: error instanceof Error ? error.name : "Unknown",
    });
    throw new WhatsAppTemplatePersistenceError(sent.messageId, error);
  }

  return {
    messageId: sent.messageId,
    contactPhone: sent.to,
    body: input.body,
    templateName: input.template.name,
    templateLanguage: input.template.language,
    status: "sent" as const,
    ...(input.sentBy ? { sentBy: input.sentBy } : {}),
    timestamp,
  };
}
