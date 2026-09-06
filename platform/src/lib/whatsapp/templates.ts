import "server-only";

import { getWhatsAppConfig, type WhatsAppConfig } from "./client";
import { getOperationalEmbeddedSignupConfig } from "./embedded-signup";

const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_VARIABLE_PATTERN = /\{\{(\d+)\}\}/g;

export type WhatsAppTemplateCategory = "MARKETING" | "UTILITY";
export type WhatsAppTemplateStatus = "APPROVED" | "DELETED" | "DISABLED" | "IN_APPEAL" | "LIMIT_EXCEEDED" | "PAUSED" | "PENDING" | "PENDING_DELETION" | "REJECTED" | string;

export type CreateWhatsAppTemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string }
  | { type: "URL"; text: string; url: string };

export type WhatsAppTemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }
  | { type: "URL"; text: string; url: string; example?: string[] };

export interface WhatsAppTemplateComponent {
  type: "BODY" | "BUTTONS" | "FOOTER" | "HEADER" | string;
  format?: string;
  text?: string;
  example?: { body_text?: string[][]; header_text?: string[] };
  buttons?: WhatsAppTemplateButton[];
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory | string;
  status: WhatsAppTemplateStatus;
  components: WhatsAppTemplateComponent[];
}

export interface CreateWhatsAppTemplateInput {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  body: string;
  examples?: string[];
  buttons?: CreateWhatsAppTemplateButton[];
}

export async function listWhatsAppTemplates() {
  const config = await requireTemplateManagementConfig();
  const query = new URLSearchParams({
    fields: "id,name,status,category,language,components",
    limit: "100",
  });
  const result = await requestGraph<{ data?: WhatsAppTemplate[] }>(
    config,
    `${config.businessAccountId}/message_templates?${query}`,
  );
  return result.data ?? [];
}

export async function createWhatsAppTemplate(input: CreateWhatsAppTemplateInput) {
  const config = await requireTemplateManagementConfig();
  const normalized = normalizeTemplateInput(input);
  const bodyComponent: WhatsAppTemplateComponent = {
    type: "BODY",
    text: normalized.body,
    ...(normalized.examples.length > 0
      ? { example: { body_text: [normalized.examples] } }
      : {}),
  };
  const components: WhatsAppTemplateComponent[] = [bodyComponent];
  if (normalized.buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: normalized.buttons });
  }
  return requestGraph<{ id: string; status: WhatsAppTemplateStatus; category: string }>(
    config,
    `${config.businessAccountId}/message_templates`,
    {
      method: "POST",
      body: JSON.stringify({
        name: normalized.name,
        language: normalized.language,
        category: normalized.category,
        components,
      }),
    },
  );
}

function normalizeTemplateInput(input: CreateWhatsAppTemplateInput) {
  const name = input.name.trim().toLowerCase();
  if (!TEMPLATE_NAME_PATTERN.test(name)) {
    throw new Error("Use apenas letras minúsculas, números e sublinhados no nome do modelo.");
  }

  const language = input.language.trim();
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) {
    throw new Error("Informe um código de idioma válido, como pt_BR.");
  }

  if (input.category !== "UTILITY" && input.category !== "MARKETING") {
    throw new Error("Selecione uma categoria válida para o modelo.");
  }

  const body = input.body.trim();
  if (!body || body.length > 1024) {
    throw new Error("O conteúdo do modelo deve ter entre 1 e 1.024 caracteres.");
  }

  const indexes = Array.from(body.matchAll(TEMPLATE_VARIABLE_PATTERN), (match) => Number(match[1]));
  const uniqueIndexes = [...new Set(indexes)].sort((left, right) => left - right);
  if (uniqueIndexes.some((value, index) => value !== index + 1)) {
    throw new Error("As variáveis devem ser sequenciais, começando por {{1}}.");
  }

  const examples = (input.examples ?? []).map((example) => example.trim());
  if (examples.length !== uniqueIndexes.length || examples.some((example) => !example)) {
    throw new Error(`Informe um exemplo para cada uma das ${uniqueIndexes.length} variáveis.`);
  }

  const buttons = normalizeButtons(input.buttons ?? []);
  return { name, language, category: input.category, body, examples, buttons };
}

function normalizeButtons(buttons: CreateWhatsAppTemplateButton[]): WhatsAppTemplateButton[] {
  if (buttons.length > 3) throw new Error("Adicione no máximo três botões ao modelo.");

  const hasQuickReplies = buttons.some((button) => button.type === "QUICK_REPLY");
  const hasCallsToAction = buttons.some((button) => button.type !== "QUICK_REPLY");
  if (hasQuickReplies && hasCallsToAction) {
    throw new Error("Use respostas rápidas ou botões de ação, sem combinar os dois formatos.");
  }
  if (hasCallsToAction && buttons.length > 2) {
    throw new Error("Adicione no máximo dois botões de ação ao modelo.");
  }
  if (buttons.filter((button) => button.type === "PHONE_NUMBER").length > 1) {
    throw new Error("Adicione no máximo um botão de telefone.");
  }

  return buttons.map((button) => {
    const text = button.text.trim();
    if (!text || text.length > 25) {
      throw new Error("O texto de cada botão deve ter entre 1 e 25 caracteres.");
    }
    if (button.type === "QUICK_REPLY") return { type: button.type, text };
    if (button.type === "PHONE_NUMBER") {
      const phoneNumber = button.phoneNumber.replace(/[\s()-]/g, "");
      if (!/^\+?[1-9]\d{7,14}$/.test(phoneNumber)) {
        throw new Error("Informe o telefone do botão com código do país.");
      }
      return { type: button.type, text, phone_number: phoneNumber };
    }

    let url: URL;
    try {
      url = new URL(button.url.trim());
    } catch {
      throw new Error("Informe uma URL completa e válida para o botão.");
    }
    if (url.protocol !== "https:") {
      throw new Error("A URL do botão deve começar com https://.");
    }
    return { type: button.type, text, url: url.toString() };
  });
}

async function requireTemplateManagementConfig(): Promise<WhatsAppConfig & { businessAccountId: string }> {
  const config = await getOperationalEmbeddedSignupConfig() ?? getWhatsAppConfig();
  if (!config) throw new Error("A integração do WhatsApp não está configurada no servidor.");
  if (!config.businessAccountId) throw new Error("A conexão do WhatsApp não possui um WABA ID.");
  return { ...config, businessAccountId: config.businessAccountId };
}

async function requestGraph<T>(
  config: WhatsAppConfig,
  path: string,
  init: Pick<RequestInit, "body" | "method"> = {},
) {
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as T & {
    error?: { message?: string; type?: string; code?: number; error_subcode?: number };
  };
  if (!response.ok || result.error) {
    const details = [
      result.error?.type,
      result.error?.code ? `code ${result.error.code}` : undefined,
      result.error?.error_subcode ? `subcode ${result.error.error_subcode}` : undefined,
    ].filter(Boolean).join(", ");
    throw new Error(
      `A Meta recusou a operação com modelos${details ? ` (${details})` : ""}: ${result.error?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return result;
}

export interface WhatsAppTemplateSendParameters {
  body: string[];
  header: string[];
  buttonUrls: Array<{ index: number; value: string }>;
}

export interface WhatsAppTemplateSendRequirements {
  bodyCount: number;
  headerCount: number;
  buttonUrls: Array<{ index: number; label: string }>;
  unsupportedReason: string | null;
}

export function getWhatsAppTemplateSendRequirements(template: WhatsAppTemplate): WhatsAppTemplateSendRequirements {
  const header = template.components.find((component) => component.type === "HEADER");
  const body = template.components.find((component) => component.type === "BODY");
  const buttons = template.components.find((component) => component.type === "BUTTONS")?.buttons ?? [];
  const unsupportedReason = header?.format && header.format !== "TEXT"
    ? "Modelos com cabeçalho de mídia ainda não podem ser enviados por esta tela."
    : null;

  return {
    bodyCount: countSequentialVariables(body?.text ?? "", "corpo"),
    headerCount: countSequentialVariables(header?.text ?? "", "cabeçalho"),
    buttonUrls: buttons.flatMap((button, index) => (
      button.type === "URL" && button.url.includes("{{1}}")
        ? [{ index, label: button.text }]
        : []
    )),
    unsupportedReason,
  };
}

export function validateWhatsAppTemplateSendParameters(
  template: WhatsAppTemplate,
  parameters: WhatsAppTemplateSendParameters,
) {
  const requirements = getWhatsAppTemplateSendRequirements(template);
  if (requirements.unsupportedReason) throw new Error(requirements.unsupportedReason);
  validateParameterGroup(parameters.header, requirements.headerCount, "cabeçalho");
  validateParameterGroup(parameters.body, requirements.bodyCount, "corpo");

  const requiredIndexes = requirements.buttonUrls.map((button) => button.index);
  const receivedIndexes = parameters.buttonUrls.map((button) => button.index);
  if (
    receivedIndexes.length !== requiredIndexes.length
    || receivedIndexes.some((index) => !requiredIndexes.includes(index))
  ) {
    throw new Error("Preencha os parâmetros de todos os botões dinâmicos.");
  }
  if (parameters.buttonUrls.some((parameter) => !parameter.value.trim() || parameter.value.length > 512)) {
    throw new Error("Os parâmetros dos botões devem ter entre 1 e 512 caracteres.");
  }

  return {
    header: parameters.header.map((value) => value.trim()),
    body: parameters.body.map((value) => value.trim()),
    buttonUrls: parameters.buttonUrls.map((parameter) => ({
      index: parameter.index,
      value: parameter.value.trim(),
    })),
  };
}

export function renderWhatsAppTemplateBody(template: WhatsAppTemplate, parameters: string[]) {
  const body = template.components.find((component) => component.type === "BODY")?.text ?? template.name;
  return body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => parameters[Number(index) - 1] ?? `{{${index}}}`);
}

function countSequentialVariables(text: string, label: string) {
  const indexes = Array.from(text.matchAll(TEMPLATE_VARIABLE_PATTERN), (match) => Number(match[1]));
  const uniqueIndexes = [...new Set(indexes)].sort((left, right) => left - right);
  if (uniqueIndexes.some((value, index) => value !== index + 1)) {
    throw new Error(`As variáveis do ${label} do modelo não são sequenciais.`);
  }
  return uniqueIndexes.length;
}

function validateParameterGroup(values: string[], expectedCount: number, label: string) {
  if (values.length !== expectedCount || values.some((value) => !value.trim() || value.length > 1024)) {
    throw new Error(`Preencha os ${expectedCount} parâmetros do ${label} do modelo.`);
  }
}