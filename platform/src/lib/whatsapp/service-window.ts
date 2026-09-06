export const WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60_000;

export function getWhatsAppServiceWindowStatus(lastInboundAt: Date | null, now = new Date()) {
  if (!lastInboundAt) {
    return {
      canSendText: false as const,
      reason: "Nenhuma mensagem recebida deste contato. Use um modelo aprovado para iniciar a conversa.",
      expiresAt: null,
    };
  }

  const expiresAt = new Date(lastInboundAt.getTime() + WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS);
  if (now >= expiresAt) {
    return {
      canSendText: false as const,
      reason: "A janela de atendimento de 24 horas terminou. Use um modelo aprovado para iniciar uma nova conversa.",
      expiresAt,
    };
  }

  return { canSendText: true as const, reason: null, expiresAt };
}