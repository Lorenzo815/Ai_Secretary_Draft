import type { ToolDefinition } from "./contracts";

const nullableString = { type: ["string", "null"] };

export const customerToolDefinitions = {
  "customer.classify_relationship": defineTool({
    label: "Classificar novo ou retorno",
    description: "Registra a resposta explícita do cliente sobre já ter consultado na clínica.",
    mutates: true,
    argumentsSchema: strictArguments(["status", "confirmedByCustomer"], {
      status: { type: "string", enum: ["new", "returning"] },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `customer.classify_relationship exige status=new ou returning e confirmedByCustomer=true.
- Use somente depois de o cliente responder explicitamente se já realizou consulta com o Dr. Matheus.
- Nunca deduza retorno apenas porque o contato já existe no CRM.`,
    execute: async (context, args) => (await import("./customer")).executeRegisteredCustomerTool("classify_relationship", context, args),
  }),
  "customer.update_profile": defineTool({
    label: "Atualizar cadastro do cliente",
    description: "Valida e salva gradualmente os dados cadastrais confirmados pelo cliente.",
    mutates: true,
    argumentsSchema: strictArguments([
      "relationshipStatus", "relationshipConfirmedByCustomer",
      "fullName", "birthDate", "cpf", "postalCode", "addressNumber",
      "addressComplement", "secondaryPhones", "profession",
    ], {
      relationshipStatus: { type: ["string", "null"], enum: ["new", "returning", null] },
      relationshipConfirmedByCustomer: { type: "boolean" },
      fullName: nullableString,
      birthDate: nullableString,
      cpf: nullableString,
      postalCode: nullableString,
      addressNumber: nullableString,
      addressComplement: nullableString,
      secondaryPhones: { type: "array", items: { type: "string" }, maxItems: 5 },
      profession: nullableString,
    }),
    promptInstructions: `customer.update_profile salva somente dados explicitamente informados pelo cliente; envie null nos campos ausentes.
  - Quando o cliente informar se é novo ou retorno, envie relationshipStatus e relationshipConfirmedByCustomer=true. Caso contrário, envie relationshipStatus=null e relationshipConfirmedByCustomer=false.
- birthDate usa AAAA-MM-DD. CPF e telefones são validados pelo servidor.
- Ao receber CEP, envie postalCode; o servidor consulta o endereço. Depois pergunte número e complemento, sem exigir complemento quando não houver.
- Pergunte um tópico por vez, mas salve juntos os dados que o cliente oferecer espontaneamente.
  - Sempre chame esta tool no mesmo turno em que o cliente fornecer qualquer dado novo, mesmo que outros campos do cadastro permaneçam pendentes.
  - Depois da execução, use somente profile.missingFields do resultado para decidir a próxima pergunta.
- Nunca copie CPF completo para reply, summary, state ou notes.`,
    execute: async (context, args) => (await import("./customer")).executeRegisteredCustomerTool("update_profile", context, args),
  getGroundedReply: customerInputGroundedReply,
  }),
} satisfies Record<string, ToolDefinition>;

function defineTool(definition: ToolDefinition) {
  return definition;
}

function strictArguments(required: string[], properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required, properties };
}

function customerInputGroundedReply(output: string) {
  try {
    const result = JSON.parse(output) as { type?: string; publicReply?: string };
    return result.type === "customer_input_error" && result.publicReply
      ? result.publicReply
      : null;
  } catch {
    return null;
  }
}