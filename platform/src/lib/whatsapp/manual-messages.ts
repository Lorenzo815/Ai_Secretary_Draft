import "server-only";

import type { ObjectId } from "mongodb";
import { cancelAutomationJob } from "../automation/queue";
import { findCustomerById, updateCustomerServiceStatus } from "../crm";
import { sendTextMessage } from "./client";
import { findLatestInboundWhatsAppMessage, saveWhatsAppMessage } from "./messages";
import { getWhatsAppServiceWindowStatus } from "./service-window";

export class ManualWhatsAppMessageError extends Error {
  constructor(
    message: string,
    readonly code: "CUSTOMER_NOT_FOUND" | "MESSAGE_INVALID" | "SERVICE_WINDOW_CLOSED",
    readonly status: number,
  ) {
    super(message);
    this.name = "ManualWhatsAppMessageError";
  }
}

export async function getManualMessageAvailability(customerId: ObjectId) {
  const customer = await findCustomerById(customerId.toString());
  if (!customer) {
    throw new ManualWhatsAppMessageError("Cliente não encontrado.", "CUSTOMER_NOT_FOUND", 404);
  }
  const latestInbound = await findLatestInboundWhatsAppMessage(customerId, customer.phones);
  const window = getWhatsAppServiceWindowStatus(latestInbound?.timestamp ?? null);

  return {
    ...window,
    recipientPhone: latestInbound?.contactPhone ?? null,
    lastInboundAt: latestInbound?.timestamp ?? null,
  };
}

export async function sendManualCustomerMessage(input: {
  customerId: ObjectId;
  body: string;
  sentBy: string;
}) {
  const body = input.body.trim();
  if (!body || body.length > 4_096) {
    throw new ManualWhatsAppMessageError(
      body ? "A mensagem deve ter no máximo 4.096 caracteres." : "Escreva uma mensagem antes de enviar.",
      "MESSAGE_INVALID",
      400,
    );
  }

  const customer = await findCustomerById(input.customerId.toString());
  if (!customer) {
    throw new ManualWhatsAppMessageError("Cliente não encontrado.", "CUSTOMER_NOT_FOUND", 404);
  }
  const latestInbound = await findLatestInboundWhatsAppMessage(input.customerId, customer.phones);
  const window = getWhatsAppServiceWindowStatus(latestInbound?.timestamp ?? null);
  if (!window.canSendText || !latestInbound) {
    throw new ManualWhatsAppMessageError(
      window.reason ?? "A janela de atendimento não está disponível para este contato.",
      "SERVICE_WINDOW_CLOSED",
      409,
    );
  }

  await updateCustomerServiceStatus(input.customerId, "human_active");
  await Promise.all([
    cancelAutomationJob("customer_agent", input.customerId),
    cancelAutomationJob("customer_follow_up", input.customerId),
  ]);

  const sent = await sendTextMessage({ to: latestInbound.contactPhone, body });
  const timestamp = new Date();
  await saveWhatsAppMessage({
    customerId: input.customerId,
    metaMessageId: sent.messageId,
    contactPhone: sent.to,
    contactName: customer.name,
    direction: "outbound",
    type: "text",
    body: sent.body,
    status: "sent",
    sentBy: input.sentBy,
    timestamp,
  });

  return {
    messageId: sent.messageId,
    contactPhone: sent.to,
    body: sent.body,
    status: "sent" as const,
    sentBy: input.sentBy,
    timestamp,
    windowExpiresAt: window.expiresAt,
  };
}