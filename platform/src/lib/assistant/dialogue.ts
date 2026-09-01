const TERMINAL_TOOL_KEYS = new Set([
  "calendar.book_first_visit",
  "calendar.book_appointment",
  "calendar.update_appointment",
]);

interface DialogueTransition {
  action: "stay" | "complete" | "transition";
  continueImmediately?: boolean;
  targetFlowKey?: string;
  reasonCode?: string;
  reason?: string;
}

export function preventPrematureJourneyCompletion(input: {
  decision: string;
  transition: DialogueTransition;
  flowKey: string;
  relationshipStatus: "new" | "returning" | "unknown";
  missingFields: string[];
}) {
  if (input.decision !== "reply" || input.transition.action !== "complete") {
    return input.transition;
  }

  const reason = "O fluxo ainda precisa conduzir explicitamente o cliente ao próximo passo.";
  if (input.flowKey === "initial_triage" && input.relationshipStatus === "new") {
    return {
      action: "transition" as const,
      continueImmediately: false,
      targetFlowKey: "collect_profile",
      reasonCode: "server_prevented_premature_completion",
      reason,
    };
  }
  if (input.flowKey === "collect_profile" && input.missingFields.length === 0) {
    return {
      action: "transition" as const,
      continueImmediately: false,
      targetFlowKey: "commercial_information",
      reasonCode: "server_prevented_premature_completion",
      reason,
    };
  }
  if (["initial_triage", "collect_profile", "commercial_information"].includes(input.flowKey)) {
    return {
      action: "stay" as const,
      continueImmediately: false,
      targetFlowKey: undefined,
      reasonCode: "server_prevented_premature_completion",
      reason,
    };
  }
  return input.transition;
}

export function ensureExplicitNextQuestion(input: {
  reply: string;
  decision: string;
  transitionAction: string;
  targetFlowKey?: string;
  flowKey: string;
  missingFields: string[];
  toolResult?: string;
}) {
  const reply = input.reply.trim();
  if (
    input.decision !== "reply"
    || input.transitionAction === "complete"
    || reply.endsWith("?")
    || toolResultNeedsNoCustomerReply(input.toolResult)
  ) {
    return reply;
  }

  const questionFlowKey = input.transitionAction === "transition" && input.targetFlowKey
    ? input.targetFlowKey
    : input.flowKey;
  const question = getNextQuestion(questionFlowKey, input.missingFields);
  const prefixLimit = Math.max(0, 4_096 - question.length - 2);
  return `${reply.slice(0, prefixLimit).trimEnd()}\n\n${question}`;
}

function getNextQuestion(flowKey: string, missingFields: string[]) {
  if (flowKey === "initial_triage") {
    return "Esta será sua primeira consulta com o Dr. Matheus ou você já é paciente de retorno?";
  }
  if (flowKey === "collect_profile") {
    const field = missingFields[0];
    if (field === "fullName") return "Para começarmos, qual é o seu nome completo?";
    if (field === "birthDate") return "Qual é a sua data de nascimento?";
    if (field === "cpf") return "Pode me informar seu CPF?";
    if (field === "postalCode") return "Qual é o CEP do seu endereço?";
    if (field === "addressNumber") return "Qual é o número do endereço?";
    if (field === "profession") return "Para concluir seu cadastro, qual é a sua profissão?";
    return "Cadastro concluído. Posso te explicar agora como funciona a primeira consulta e os valores?";
  }
  if (flowKey === "commercial_information") {
    return "Quer seguir para o próximo passo e confirmar o sinal da consulta?";
  }
  if (flowKey === "payment_confirmation") {
    return "Deseja prosseguir com o pagamento do sinal via Pix?";
  }
  if (flowKey === "schedule_appointment") {
    return "Você prefere fazer a Bioimpedância e a consulta em sequência ou em horários separados?";
  }
  return "Como você prefere seguir?";
}

function toolResultNeedsNoCustomerReply(output?: string) {
  if (!output) return false;
  try {
    const envelope = JSON.parse(output) as {
      executedTools?: string[];
      results?: Array<{ ok?: boolean; type?: string }>;
    };
    if (envelope.results?.some((result) => result.type === "operational_error")) return true;
    return envelope.executedTools?.some((tool, index) => (
      TERMINAL_TOOL_KEYS.has(tool) && envelope.results?.[index]?.ok === true
    )) ?? false;
  } catch {
    return false;
  }
}