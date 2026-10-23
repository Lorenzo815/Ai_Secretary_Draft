import type { ToolDefinition } from "./contracts";

export const paymentToolDefinitions = {
  "payment.request_deposit": {
    label: "Solicitar sinal via Pix",
    description: "Cria uma solicitação de sinal usando a configuração administrativa atual.",
    mutates: true,
    argumentsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["confirmedByCustomer", "payerEmail"],
      properties: {
        confirmedByCustomer: { type: "boolean" },
        payerEmail: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    promptInstructions: `payment.request_deposit exige confirmedByCustomer=true.
- Use somente depois de o cliente aceitar explicitamente a emissão da cobrança e o pagamento do sinal; não é necessário já ter pago para gerar a solicitação.
- Chave, favorecido e valor vêm exclusivamente da configuração administrativa; nunca os invente.
- Consulte runtime.operations.paymentProvider: para mercado_pago, use o e-mail real do pagador já informado ou colete-o antes de chamar e envie em payerEmail; para manual, envie null e não peça e-mail. Não presuma um provedor fixo a partir de orientações antigas.
- Respeite os dados obrigatórios e a reserva exigidos pela configuração do atendimento. Não emita cobrança para consultar horários ou dentro de um reagendamento.
- Depois da solicitação, aguarde a confirmação automática do provedor ou a revisão humana configurada.`,
    execute: async (context, args) => (await import("./payment")).executePaymentRequestTool(context, args),
    getGroundedReply: (output: string) => {
      const result = JSON.parse(output) as {
        ok?: boolean;
        amountCents?: number;
        pixKey?: string;
        recipientName?: string;
        qrCode?: string;
        provider?: string;
        type?: string;
      };
      if (result.ok && result.amountCents && result.provider === "mercado_pago" && result.qrCode) {
        const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
          .format(result.amountCents / 100);
        return `Para garantir o horário, realize o sinal de ${amount} via Pix usando o código copia e cola: ${result.qrCode}. A confirmação será automática após o Mercado Pago aprovar a transação.`;
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