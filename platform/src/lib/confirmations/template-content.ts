// The appointment confirmation WhatsApp template (no database access). Its text is editable by the clinic before it
// is submitted to Meta; name, language, variables and the three quick replies are fixed, because Oria reads them.

export const CONFIRMATION_BUTTONS = [
  { action: "confirm", text: "Confirmar presença" },
  { action: "reschedule", text: "Escolher novo horário" },
  { action: "cancel", text: "Cancelar consulta" },
] as const;
export type ConfirmationAction = typeof CONFIRMATION_BUTTONS[number]["action"];

export const DEFAULT_CONFIRMATION_TEMPLATE = {
  name: "oria_confirmacao_consulta",
  language: "pt_BR",
  body: "Olá, {{1}}! Passando para confirmar seu atendimento de {{2}}: {{3}}.\n\nVocê confirma sua presença? Se não houver confirmação, seu horário poderá ser remarcado.",
};

/** Examples Meta requires for each variable when the template is submitted. */
export const CONFIRMATION_TEMPLATE_EXAMPLES = ["Maria", "sexta-feira, 06/11", "10:00 Consulta; 10:30 Bioimpedância"];

export const CONFIRMATION_TEMPLATE_HELP = "Lembretes de consulta costumam chegar quando a conversa com o paciente está parada há mais de 24 horas. Fora dessa janela, o WhatsApp só permite enviar mensagens de um modelo aprovado pela Meta. Por isso a confirmação só pode ser ativada com este modelo aprovado.";

export function validateConfirmationTemplateBody(body: string) {
  const text = body.trim();
  if (!text || text.length > 1024) throw new Error("O texto do modelo deve ter entre 1 e 1.024 caracteres.");
  const variables = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  if ([1, 2, 3].some((index) => variables.filter((value) => value === index).length !== 1) || variables.length !== 3) {
    throw new Error("O texto deve usar {{1}} (nome), {{2}} (data) e {{3}} (horários), uma vez cada.");
  }
  if (/^\{\{\d+\}\}/.test(text) || /\{\{\d+\}\}[.!?]?$/.test(text)) {
    throw new Error("A Meta não aceita variáveis no início ou no fim do texto.");
  }
  return text;
}

/** Template parameters can't contain line breaks, tabs or more than 4 spaces in a row. */
export function templateParameter(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 300) || "-";
}

export function renderConfirmationBody(body: string, parameters: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (match, index) => parameters[Number(index) - 1] ?? match);
}

const PAYLOAD_PREFIX = "oria_cc";

export function confirmationPayload(confirmationId: string, action: ConfirmationAction) {
  return `${PAYLOAD_PREFIX}:${confirmationId}:${action}`;
}

export function parseConfirmationPayload(payload: string | undefined | null) {
  const match = payload?.match(/^oria_cc:([a-f0-9]{24}):(confirm|reschedule|cancel)$/);
  return match ? { confirmationId: match[1], action: match[2] as ConfirmationAction } : null;
}
