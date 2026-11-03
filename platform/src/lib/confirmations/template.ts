import "server-only";

import { currentCompanyId } from "../companies/context";
import { getCompanyWhatsAppConfig } from "../whatsapp/client";
import { createWhatsAppTemplate, getCachedWhatsAppTemplates, listWhatsAppTemplates, type WhatsAppTemplate } from "../whatsapp/templates";
import { CONFIRMATION_BUTTONS, CONFIRMATION_TEMPLATE_EXAMPLES, DEFAULT_CONFIRMATION_TEMPLATE, validateConfirmationTemplateBody } from "./template-content";

export type ConfirmationTemplateState = "approved" | "pending" | "rejected" | "missing" | "invalid" | "paused" | "unavailable";

export interface ConfirmationTemplateStatus {
  state: ConfirmationTemplateState;
  metaStatus: string | null;
  /** Text approved by Meta (what patients receive), when the template exists. */
  body: string | null;
  message: string;
}

const MESSAGES: Record<ConfirmationTemplateState, string> = {
  approved: "Modelo aprovado pela Meta. A confirmação pode ser ativada.",
  pending: "Modelo enviado e em análise pela Meta (costuma levar de minutos a 24 horas).",
  rejected: "A Meta recusou o modelo. Ajuste o texto e envie de novo.",
  missing: "O modelo de confirmação ainda não foi criado.",
  invalid: "Existe um modelo com este nome, mas sem os três botões esperados. Exclua-o em Modelos WhatsApp e envie de novo.",
  paused: "A Meta pausou ou desativou o modelo. Os lembretes não serão enviados.",
  unavailable: "Não foi possível consultar os modelos: conecte o WhatsApp da clínica em Sistema.",
};

/** Status of the confirmation template at Meta. `fresh` skips the 15-minute catalog cache (screens); the worker uses the cache. */
export async function getConfirmationTemplateStatus(options: { fresh?: boolean } = {}): Promise<ConfirmationTemplateStatus> {
  let templates: WhatsAppTemplate[];
  try {
    if (options.fresh) {
      templates = await listWhatsAppTemplates();
    } else {
      const companyId = await currentCompanyId();
      const config = await getCompanyWhatsAppConfig(companyId);
      if (!config?.businessAccountId) return status("unavailable", null, null);
      templates = await getCachedWhatsAppTemplates(companyId, config.businessAccountId);
    }
  } catch {
    return status("unavailable", null, null);
  }
  return confirmationTemplateStatusFromList(templates);
}

/** Same as getConfirmationTemplateStatus, for a template list already loaded (e.g. the Modelos WhatsApp page). */
export function confirmationTemplateStatusFromList(templates: WhatsAppTemplate[]): ConfirmationTemplateStatus {
  const template = templates.find((item) => item.name === DEFAULT_CONFIRMATION_TEMPLATE.name && item.language === DEFAULT_CONFIRMATION_TEMPLATE.language);
  if (!template) return status("missing", null, null);
  const body = template.components.find((component) => component.type === "BODY")?.text ?? null;
  const buttons = template.components.find((component) => component.type === "BUTTONS")?.buttons ?? [];
  const buttonsMatch = buttons.length === CONFIRMATION_BUTTONS.length && buttons.every((button) => button.type === "QUICK_REPLY");
  const metaStatus = String(template.status);
  if (!buttonsMatch) return status("invalid", metaStatus, body);
  if (metaStatus === "APPROVED") return status("approved", metaStatus, body);
  if (metaStatus === "REJECTED") return status("rejected", metaStatus, body);
  if (["PAUSED", "DISABLED", "DELETED", "PENDING_DELETION", "LIMIT_EXCEEDED"].includes(metaStatus)) return status("paused", metaStatus, body);
  return status("pending", metaStatus, body);
}

/** Submits Oria's confirmation template (UTILITY, pt_BR, three quick replies) with the clinic's text. */
export async function submitConfirmationTemplate(body: string) {
  const text = validateConfirmationTemplateBody(body);
  return createWhatsAppTemplate({
    name: DEFAULT_CONFIRMATION_TEMPLATE.name,
    language: DEFAULT_CONFIRMATION_TEMPLATE.language,
    category: "UTILITY",
    body: text,
    examples: CONFIRMATION_TEMPLATE_EXAMPLES,
    buttons: CONFIRMATION_BUTTONS.map((button) => ({ type: "QUICK_REPLY" as const, text: button.text })),
  });
}

function status(state: ConfirmationTemplateState, metaStatus: string | null, body: string | null): ConfirmationTemplateStatus {
  return { state, metaStatus, body, message: MESSAGES[state] };
}
