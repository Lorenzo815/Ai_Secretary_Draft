import "server-only";

import type { ObjectId } from "mongodb";
import { getCachedWhatsAppTemplates, type WhatsAppTemplate, type WhatsAppTemplateSendParameters } from "./templates";

interface TemplateParameter {
  type: string;
  text?: string;
  payload?: string;
  parameter_name?: string;
  currency?: { fallback_value?: string };
  date_time?: { fallback_value?: string };
}

export interface WhatsAppTemplatePayload {
  id?: string;
  name?: string;
  language?: { code?: string };
  components?: Array<{ type: string; parameters?: TemplateParameter[] }>;
}

function renderText(text: string, parameters: TemplateParameter[]) {
  const placeholders = [...new Set(Array.from(text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g), match => match[1]))];
  if (parameters.length !== placeholders.length) throw new Error("WHATSAPP_TEMPLATE_PARAMETERS_MISSING_OR_EXTRA");
  const values = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    if (!parameter || typeof parameter.type !== "string") throw new Error("WHATSAPP_TEMPLATE_PARAMETER_INVALID");
    const key = parameter.parameter_name ?? String(index + 1);
    const value = parameter.type === "text" ? parameter.text
      : parameter.type === "currency" ? parameter.currency?.fallback_value
        : parameter.type === "date_time" ? parameter.date_time?.fallback_value : undefined;
    if (typeof value !== "string" || values.has(key)) throw new Error("WHATSAPP_TEMPLATE_PARAMETER_INVALID");
    values.set(key, value);
  }
  for (const key of placeholders) {
    if (!values.has(key)) throw new Error("WHATSAPP_TEMPLATE_PARAMETERS_MISSING_OR_EXTRA");
  }
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => values.get(key)!);
}

export function renderWhatsAppTemplateContext(template: WhatsAppTemplate, payload: WhatsAppTemplatePayload) {
  const components = payload.components ?? [];
  if (!Array.isArray(components) || !Array.isArray(template.components)) throw new Error("WHATSAPP_TEMPLATE_COMPONENTS_INVALID");
  if (components.some(component => !component || typeof component.type !== "string" ||
    !["HEADER", "BODY", "BUTTON"].includes(component.type.toUpperCase())) ||
    template.components.some(component => !component || typeof component.type !== "string")) {
    throw new Error("WHATSAPP_TEMPLATE_COMPONENTS_INVALID");
  }
  const lines: string[] = [];
  const seen = new Set<string>();
  const order = ["HEADER", "BODY", "FOOTER", "BUTTONS"];
  for (const component of [...template.components].sort((left, right) =>
    order.indexOf(left.type.toUpperCase()) - order.indexOf(right.type.toUpperCase()))) {
    const type = component.type.toUpperCase();
    if (seen.has(type) || !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(type)) {
      throw new Error("WHATSAPP_TEMPLATE_COMPONENT_UNSUPPORTED");
    }
    seen.add(type);
    const matches = components.filter(value => value.type.toUpperCase() === type);
    if (matches.length > 1) throw new Error("WHATSAPP_TEMPLATE_COMPONENTS_INVALID");
    const parameters = matches[0]?.parameters ?? [];
    if (!Array.isArray(parameters)) throw new Error("WHATSAPP_TEMPLATE_PARAMETERS_INVALID");
    if (type === "BUTTONS") {
      const buttons = component.buttons ?? [];
      if (buttons.some(button => typeof button.text !== "string")) throw new Error("WHATSAPP_TEMPLATE_BUTTONS_INVALID");
      if (buttons.length) lines.push(`Opções: ${buttons.map(button => button.text).join(" | ")}`);
    } else if (type === "HEADER" && component.format && component.format !== "TEXT") {
      lines.push(`[Cabeçalho: ${component.format.toLowerCase()}]`);
    } else {
      if (typeof component.text !== "string") throw new Error("WHATSAPP_TEMPLATE_COMPONENT_TEXT_MISSING");
      lines.push(renderText(component.text, parameters));
    }
  }
  if (!seen.has("BODY")) throw new Error("WHATSAPP_TEMPLATE_BODY_MISSING");
  for (const component of components) {
    if (["HEADER", "BODY"].includes(component.type.toUpperCase()) && !seen.has(component.type.toUpperCase())) {
      throw new Error("WHATSAPP_TEMPLATE_COMPONENTS_INVALID");
    }
  }
  return { body: lines.filter(Boolean).join("\n\n"), templateName: template.name, templateLanguage: template.language };
}

export function renderSentWhatsAppTemplateContext(template: WhatsAppTemplate, parameters: WhatsAppTemplateSendParameters) {
  return renderWhatsAppTemplateContext(template, {
    id: template.id,
    name: template.name,
    language: { code: template.language },
    components: [
      { type: "header", parameters: parameters.header.map(text => ({ type: "text", text })) },
      { type: "body", parameters: parameters.body.map(text => ({ type: "text", text })) },
    ].filter(component => component.parameters.length > 0),
  });
}

export async function hydrateWhatsAppTemplateContext(
  companyId: ObjectId,
  wabaId: string,
  payload: WhatsAppTemplatePayload | undefined,
) {
  if (!payload || (!payload.id && (!payload.name || !payload.language?.code))) {
    throw new Error("WHATSAPP_TEMPLATE_REFERENCE_MISSING");
  }
  if ((payload.id !== undefined && typeof payload.id !== "string") ||
    (payload.name !== undefined && typeof payload.name !== "string") ||
    (payload.language?.code !== undefined && typeof payload.language.code !== "string")) {
    throw new Error("WHATSAPP_TEMPLATE_REFERENCE_INVALID");
  }
  const templates = await getCachedWhatsAppTemplates(companyId, wabaId);
  const matches = templates.filter(template =>
    (!payload.id || template.id === payload.id) &&
    (!payload.name || template.name === payload.name) &&
    (!payload.language?.code || template.language === payload.language.code));
  if (matches.length !== 1) throw new Error("WHATSAPP_TEMPLATE_REFERENCE_UNRESOLVED");
  return renderWhatsAppTemplateContext(matches[0], payload);
}
