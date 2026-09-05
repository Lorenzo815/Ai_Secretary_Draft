import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { getOperationalEmbeddedSignupConfig } from "./embedded-signup";

const DEFAULT_GRAPH_VERSION = "v25.0";

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  verifyToken?: string;
  appSecret?: string;
  graphVersion: string;
}

export interface WhatsAppPublicStatus {
  configured: boolean;
  missingVariables: string[];
  phoneNumberId: string | null;
  businessAccountId: string | null;
  graphVersion: string;
  webhookVerificationConfigured: boolean;
  webhookSignatureConfigured: boolean;
}

export interface SendTemplateInput {
  to: string;
  customerName: string;
  orderNumber: string;
  orderDate: string;
}

export interface SendTextInput {
  to: string;
  body: string;
}

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) return null;

  return {
    accessToken,
    phoneNumberId,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION,
  };
}

export async function getWhatsAppPublicStatus(): Promise<WhatsAppPublicStatus> {
  const operationalConfig = await getOperationalEmbeddedSignupConfig();
  const config = operationalConfig ?? getWhatsAppConfig();
  const missingVariables = operationalConfig ? [] : [
    !process.env.WHATSAPP_ACCESS_TOKEN && "WHATSAPP_ACCESS_TOKEN",
    !process.env.WHATSAPP_PHONE_NUMBER_ID && "WHATSAPP_PHONE_NUMBER_ID",
  ].filter((variable): variable is string => Boolean(variable));

  return {
    configured: Boolean(config),
    missingVariables,
    phoneNumberId: config?.phoneNumberId ?? null,
    businessAccountId: config?.businessAccountId ?? null,
    graphVersion: config?.graphVersion ?? DEFAULT_GRAPH_VERSION,
    webhookVerificationConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    webhookSignatureConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
  };
}

export async function sendSampleTemplate(input: SendTemplateInput) {
  const config = await requireWhatsAppConfig();
  const to = normalizePhone(input.to);
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "jaspers_market_order_confirmation_v1",
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: input.customerName },
            { type: "text", text: input.orderNumber },
            { type: "text", text: input.orderDate },
          ],
        },
      ],
    },
  };

  const messageId = await sendPayload(config, payload);
  return { messageId, to, payload };
}

export async function sendTextMessage(input: SendTextInput) {
  const config = await requireWhatsAppConfig();
  const to = normalizePhone(input.to);
  const body = input.body.trim();
  if (!body) throw new Error("Escreva uma mensagem antes de enviar.");
  if (body.length > 4096) throw new Error("A mensagem deve ter no máximo 4.096 caracteres.");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  };
  const messageId = await sendPayload(config, payload);
  return { messageId, to, body };
}

export function isValidWebhookSignature(rawBody: string, signature: string | null) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true;
  if (!signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);

  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function requireWhatsAppConfig() {
  const config = await getOperationalEmbeddedSignupConfig() ?? getWhatsAppConfig();
  if (!config) throw new Error("A integração do WhatsApp não está configurada no servidor.");
  return config;
}

function normalizePhone(phone: string) {
  const normalized = phone.replace(/\D/g, "");
  if (!normalized) throw new Error("Informe um telefone válido com código do país.");
  return normalized;
}

async function sendPayload(config: WhatsAppConfig, payload: object) {
  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = (await response.json()) as {
    messages?: Array<{ id: string }>;
    error?: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
    };
  };

  if (!response.ok || !result.messages?.[0]?.id) {
    const details = [
      result.error?.type,
      result.error?.code ? `code ${result.error.code}` : undefined,
      result.error?.error_subcode ? `subcode ${result.error.error_subcode}` : undefined,
    ].filter(Boolean).join(", ");
    throw new Error(
      `WhatsApp Cloud API recusou o envio${details ? ` (${details})` : ""}: ${result.error?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return result.messages[0].id;
}