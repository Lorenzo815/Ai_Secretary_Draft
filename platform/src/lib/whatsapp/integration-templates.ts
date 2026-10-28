import "server-only";

import { legacyCompanyId } from "../companies/ownership";
import { findOrCreateCustomerFromWhatsApp } from "../crm/customers";
import { renderSentWhatsAppTemplateContext } from "./template-context";
import { sendAndStoreCustomerTemplate, WhatsAppTemplatePersistenceError } from "./template-messages";
import { listWhatsAppTemplates, validateWhatsAppTemplateSendParameters, type WhatsAppTemplateSendParameters } from "./templates";

export class IntegrationWhatsAppTemplateError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "IntegrationWhatsAppTemplateError";
  }
}

function invalid(message: string): never {
  throw new IntegrationWhatsAppTemplateError(message, "TEMPLATE_PAYLOAD_INVALID", 400);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    invalid("O payload contém campos não suportados para envio de template.");
  }
}

function textParameters(value: unknown) {
  if (!Array.isArray(value)) invalid("Os parâmetros devem ser uma lista de objetos de texto.");
  return value.map((parameter: unknown) => {
    if (!record(parameter) || parameter.type !== "text" || typeof parameter.text !== "string") {
      invalid("Somente parâmetros posicionais do tipo text são suportados.");
    }
    checkKeys(parameter, ["type", "text"]);
    return parameter.text;
  });
}

export function parseIntegrationTemplateRequest(input: unknown) {
  if (!record(input) || input.messaging_product !== "whatsapp" || input.type !== "template") {
    invalid('Envie um comando com messaging_product="whatsapp", type="template", to e template. Esta rota não recebe mais envelopes de webhook.');
  }
  checkKeys(input, ["messaging_product", "recipient_type", "to", "type", "template"]);
  if (input.recipient_type !== undefined && input.recipient_type !== "individual") {
    invalid("Somente destinatários individuais são suportados.");
  }
  if (typeof input.to !== "string" || !/^[1-9]\d{4,14}$/.test(input.to)) {
    invalid("Informe to com o telefone internacional do lead, somente dígitos, entre 5 e 15 caracteres.");
  }
  const template = input.template;
  if (!record(template) || typeof template.name !== "string" || !/^[a-z0-9_]{1,512}$/.test(template.name)) {
    invalid("Informe um nome de template válido.");
  }
  checkKeys(template, ["name", "language", "components"]);
  if (!record(template.language) || typeof template.language.code !== "string" ||
    !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(template.language.code)) {
    invalid("Informe o idioma do template, por exemplo pt_BR.");
  }
  checkKeys(template.language, ["code"]);
  const components: unknown = template.components === undefined ? [] : template.components;
  if (!Array.isArray(components)) invalid("template.components deve ser uma lista.");
  const parameters: WhatsAppTemplateSendParameters = { header: [], body: [], buttonUrls: [] };
  const seen = new Set<string>();
  for (const component of components) {
    if (!record(component) || typeof component.type !== "string" || !["header", "body", "button"].includes(component.type)) {
      invalid("São suportados apenas componentes header/body de texto e botões de URL dinâmica.");
    }
    const values = textParameters(component.parameters);
    if (component.type === "button") {
      checkKeys(component, ["type", "sub_type", "index", "parameters"]);
      if (component.sub_type !== "url" || typeof component.index !== "string" ||
        !/^[0-9]$/.test(component.index) || values.length !== 1) {
        invalid("Cada botão dinâmico deve ter sub_type=url, index de 0 a 9 e um parâmetro de texto.");
      }
      const key = `button:${component.index}`;
      if (seen.has(key)) invalid("Há componentes duplicados no template.");
      seen.add(key);
      parameters.buttonUrls.push({ index: Number(component.index), value: values[0] });
    } else {
      checkKeys(component, ["type", "parameters"]);
      const type = component.type === "header" ? "header" : "body";
      if (seen.has(type)) invalid("Há componentes duplicados no template.");
      seen.add(type);
      parameters[type] = values;
    }
  }
  return { to: input.to, name: template.name, language: template.language.code, parameters };
}

export async function sendIntegrationTemplate(input: unknown) {
  const parsed = parseIntegrationTemplateRequest(input);
  const matches = (await listWhatsAppTemplates()).filter(template =>
    template.name === parsed.name && template.language === parsed.language);
  if (matches.length !== 1 || matches[0].status !== "APPROVED") {
    throw new IntegrationWhatsAppTemplateError(
      "O template e idioma devem identificar um único modelo aprovado no catálogo configurado da Oria.",
      "TEMPLATE_UNAVAILABLE", 409,
    );
  }
  const template = matches[0];
  let parameters: WhatsAppTemplateSendParameters;
  let body: string;
  try {
    parameters = validateWhatsAppTemplateSendParameters(template, parsed.parameters);
    body = renderSentWhatsAppTemplateContext(template, parameters).body;
  } catch (error) {
    throw new IntegrationWhatsAppTemplateError(
      error instanceof Error ? error.message : "Os parâmetros do template são inválidos.",
      "TEMPLATE_PARAMETERS_INVALID", 400,
    );
  }
  const customer = await findOrCreateCustomerFromWhatsApp({
    phone: parsed.to, interactionAt: new Date(), companyId: legacyCompanyId(),
  });
  try {
    return await sendAndStoreCustomerTemplate({ customer, to: parsed.to, template, parameters, body });
  } catch (error) {
    if (error instanceof WhatsAppTemplatePersistenceError) throw error;
    console.error("WhatsApp integration template send could not be confirmed.", {
      errorType: error instanceof Error ? error.name : "Unknown",
    });
    throw new IntegrationWhatsAppTemplateError(
      "Não foi possível confirmar o envio pela Meta. Verifique antes de repetir para evitar mensagens duplicadas.",
      "TEMPLATE_SEND_UNCONFIRMED", 502,
    );
  }
}
