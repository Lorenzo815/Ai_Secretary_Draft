import type { ToolDefinition } from "./contracts";

export const paymentToolDefinitions = {
  "payment.request_deposit": {
    label: "Solicitar sinal via Pix",
    description: "Cria uma solicitação de sinal usando a configuração administrativa atual.",
    mutates: true,
    argumentsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["confirmedByCustomer"],
      properties: { confirmedByCustomer: { type: "boolean" } },
    },
    promptInstructions: `payment.request_deposit exige confirmedByCustomer=true.
- Use somente depois de o cliente aceitar prosseguir com a primeira consulta e pagar o sinal.
- Chave, favorecido e valor vêm exclusivamente da configuração administrativa; nunca os invente.
- Depois da solicitação, o atendimento aguarda confirmação humana do pagamento.`,
    execute: async (context, args) => (await import("./payment")).executePaymentRequestTool(context, args),
    getGroundedReply: (output: string) => {
      const result = JSON.parse(output) as {
        ok?: boolean;
        amountCents?: number;
        pixKey?: string;
        recipientName?: string;
        type?: string;
      };
      if (result.ok && result.amountCents && result.pixKey && result.recipientName) {
        const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
          .format(result.amountCents / 100);
        return `Para garantir o horário, realize o sinal de ${amount} via Pix. Chave: ${result.pixKey}. Favorecido: ${result.recipientName}. Quando concluir o pagamento, pode me avisar por aqui para a equipe confirmar?`;
      }
      return result.type === "operational_error"
        ? "Ainda não consigo gerar os dados do sinal. Encaminhei para a equipe da clínica conferir a configuração."
        : null;
    },
  },
} satisfies Record<string, ToolDefinition>;