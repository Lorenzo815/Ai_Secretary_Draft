import type { ToolDefinition } from "./contracts";

export const paymentToolDefinitions = {
  "payment.request_deposit": {
    label: "Solicitar sinal via Pix",
    description: "Cria a solicitação de sinal da reserva temporária ativa, com o valor do plano reservado.",
    mutates: true,
    argumentsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["confirmedByCustomer", "payerEmail", "method"],
      properties: {
        confirmedByCustomer: { type: "boolean" },
        payerEmail: { anyOf: [{ type: "string" }, { type: "null" }] },
        method: { anyOf: [{ type: "string", enum: ["pix", "payment_link"] }, { type: "null" }] },
      },
    },
    promptInstructions: `payment.request_deposit exige confirmedByCustomer=true.
- Use somente depois de o cliente aceitar explicitamente a emissão da cobrança e o pagamento do sinal; não é necessário já ter pago para gerar a solicitação.
- Exige uma reserva temporária ativa (calendar.hold) de um plano que exige sinal: o sinal é desse agendamento. Chave, favorecido e valor (o do plano) vêm exclusivamente da configuração administrativa; nunca os invente.
- Se o resultado indicar held_booking_required, reserve primeiro o horário escolhido com calendar.hold; se indicar deposit_not_required, não fale de pagamento.
- Consulte runtime.operations.paymentProvider: para mercado_pago, use o e-mail real do pagador já informado ou colete-o antes de chamar e envie em payerEmail; para manual, envie null e não peça e-mail. Não presuma um provedor fixo a partir de orientações antigas.
- runtime.operations.paymentMethods lista os meios aceitos. "pix" envia um código Pix copia e cola no chat; "payment_link" envia um link do Mercado Pago (runtime.operations.paymentLinkMethods diz o que ele aceita: cartão de crédito, débito, boleto, Pix; e o máximo de parcelas). Se houver mais de um meio, pergunte ao cliente qual prefere antes de chamar e envie method; com um só meio, envie esse meio. Em modo manual, envie method=null.
- Nunca peça nem aceite dados de cartão pelo WhatsApp: cartão e boleto só pelo link de pagamento.
- Respeite os dados obrigatórios e a reserva exigidos pela configuração do atendimento. Não emita cobrança para consultar horários ou dentro de um reagendamento.
- Quando a solicitação é criada, o sistema envia automaticamente ao cliente os dados do Pix; não repita a chave nem encaminhe para a equipe por causa disso.
- O status "awaiting_human_confirmation" significa apenas que a equipe confere o Pix depois que o cliente pagar; não é motivo para human_handoff. Se o cliente disser que vai pagar depois, isso é normal: a reserva continua até o prazo informado.
- Se o cliente pedir a chave de novo, chame payment.request_deposit outra vez: a solicitação existente é reaproveitada, sem nova cobrança.`,
    execute: async (context, args) => (await import("./payment")).executePaymentRequestTool(context, args),
    getGroundedReply: (output: string) => {
      const result = JSON.parse(output) as {
        ok?: boolean;
        amountCents?: number;
        pixKey?: string;
        recipientName?: string;
        qrCode?: string;
        paymentUrl?: string;
        expiresAt?: string | null;
        linkMethods?: string[];
        maxInstallments?: number;
        channel?: string;
        provider?: string;
        type?: string;
      };
      const formatAmount = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      const until = result.expiresAt ? ` Ele vale até ${formatDeadline(result.expiresAt)}.` : "";
      if (result.ok && result.amountCents && result.provider === "mercado_pago" && result.channel === "payment_link" && result.paymentUrl) {
        return `Para garantir o horário, pague o sinal de ${formatAmount(result.amountCents)} por este link do Mercado Pago: ${result.paymentUrl}\nVocê pode pagar com ${describeLinkMethods(result.linkMethods ?? [], result.maxInstallments ?? 1)}.${until.replace("Ele", "O link")} A confirmação chega automaticamente aqui.`;
      }
      if (result.ok && result.amountCents && result.provider === "mercado_pago" && result.qrCode) {
        return `Para garantir o horário, realize o sinal de ${formatAmount(result.amountCents)} via Pix com este código copia e cola:\n\n${result.qrCode}\n\nNo app do banco, escolha Pix > Copia e cola.${until.replace("Ele", "O código")} A confirmação é automática.`;
      }
      if (result.ok && result.amountCents && result.pixKey && result.recipientName) {
        const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
          .format(result.amountCents / 100);
        return `Para garantir o horário, realize o sinal de ${amount} via Pix. Chave: ${result.pixKey}. Favorecido: ${result.recipientName}. Quando concluir o pagamento, pode me avisar por aqui para a equipe confirmar?`;
      }
      return result.type === "operational_error"
        ? "Ainda não consigo gerar os dados do sinal. A equipe da clínica precisa conferir a configuração."
        : null;
    },
  },
} satisfies Record<string, ToolDefinition>;
function formatDeadline(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso)).replace(", ", " às ");
}

function describeLinkMethods(methods: string[], maxInstallments: number) {
  const labels = methods.map((method) => method === "credit_card"
    ? maxInstallments > 1 ? `cartão de crédito (em até ${maxInstallments}x)` : "cartão de crédito"
    : method === "debit_card" ? "cartão de débito" : method === "ticket" ? "boleto" : method === "bank_transfer" ? "Pix" : method);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} ou ${labels.at(-1)}` : labels[0] ?? "cartão";
}
