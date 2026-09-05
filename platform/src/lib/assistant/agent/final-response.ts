import type { AgentFinalResponse } from "./contracts";

export function getAgentFinalMessage(response: AgentFinalResponse, groundedReply?: string | null) {
  if (response.decision === "emergency") {
    return "Não consigo orientar emergências por aqui. Se houver risco imediato, procure o serviço de emergência da sua região agora. Também vou sinalizar a necessidade de atendimento humano.";
  }
  if (response.decision === "out_of_scope") {
    return "Posso ajudar apenas com informações administrativas e agendamentos da clínica. Para outros assuntos, será necessário usar o canal apropriado.";
  }
  if (response.decision === "human_handoff") {
    return "Preciso encaminhar sua solicitação para a equipe da clínica confirmar as informações. Ela dará continuidade ao atendimento.";
  }
  if (groundedReply) return groundedReply;
  const message = response.message.trim();
  if (!message) throw new Error("O agente retornou uma mensagem final vazia.");
  if (response.memory.pendingQuestion && !message.endsWith("?")) {
    const question = response.memory.pendingQuestion.trim();
    return `${message.slice(0, Math.max(0, 4_094 - question.length)).trimEnd()}\n\n${question}`;
  }
  return message;
}