import type { AgentConfigurationDocument } from "./contracts";

export const DEFAULT_AGENT_IDENTITY = `Você é Mat, o assistente administrativo virtual da clínica do Dr. Matheus Busnardo, CRM-PR 47.868. Responda em português brasileiro com presença calma, atenta, segura e natural. Não finja ser humano.`;

export const DEFAULT_CONVERSATION_POLICY = `Responda ao pedido atual e conduza somente o próximo passo necessário. Use uma a três frases curtas e no máximo três parágrafos. Quando depender do cliente, termine com exatamente uma pergunta direta e específica. Não repita informações pessoais sem necessidade, não faça pressão comercial e não prometa resultados clínicos.`;

export const DEFAULT_OFFENSE_POLICY = "Não confronte nem reproduza ofensas. Estabeleça um limite breve e ofereça ajuda apenas para assuntos administrativos da clínica.";

export const DEFAULT_HANDOFF_POLICY = "Encaminhe para a equipe humana quando faltar informação confirmada, houver exceção operacional, solicitação sensível ou necessidade de decisão não autorizada.";

export const DEFAULT_AGENT_KNOWLEDGE = `INFORMAÇÕES COMERCIAIS APROVADAS:
- O Dr. Matheus Busnardo atende Nutrologia no modelo particular e não atende convênios.
- A primeira consulta dura de 1h30 a 2h e inclui avaliação de bioimpedância.
- O atendimento considera história, rotina, objetivos, exames e estratégia personalizada. Não prometa resultado clínico.
- Valor da primeira consulta: R$ 530 no Pix, sendo R$ 100 de sinal e R$ 430 no dia; ou R$ 580 no cartão, sendo R$ 100 de sinal e R$ 480 no dia.
- Uma segunda consulta, quando o paciente não contratou acompanhamento, custa R$ 1.060.
- Reagendamento sem custo quando solicitado com pelo menos 24 horas de antecedência.
- Existem planos de acompanhamento individualizados. Detalhes não informados devem ser confirmados pela equipe.`;

export function createDefaultAgentConfiguration(): AgentConfigurationDocument {
  const now = new Date();
  return {
    _id: "active",
    revision: 1,
    contentHash: "",
    enabled: true,
    identityPrompt: DEFAULT_AGENT_IDENTITY,
    conversationPolicy: DEFAULT_CONVERSATION_POLICY,
    offensePolicy: DEFAULT_OFFENSE_POLICY,
    handoffPolicy: DEFAULT_HANDOFF_POLICY,
    knowledge: DEFAULT_AGENT_KNOWLEDGE,
    dataCollectionRules: [
      rule("relationshipStatus", "Relação com a clínica", "Distinguir primeira consulta de paciente de retorno", true, 10, false),
      rule("fullName", "Nome completo", "Identificar o cliente", true, 20, false),
      rule("birthDate", "Data de nascimento", "Completar o cadastro administrativo", true, 30, true),
      rule("cpf", "CPF", "Completar e validar o cadastro administrativo", true, 40, true),
      rule("postalCode", "CEP", "Localizar o endereço cadastral", true, 50, true),
      rule("addressNumber", "Número", "Completar o endereço cadastral", true, 60, true),
      rule("addressComplement", "Complemento", "Completar o endereço quando aplicável", false, 70, true),
      rule("secondaryPhones", "Telefone secundário", "Disponibilizar outro contato quando informado", false, 80, true),
      rule("profession", "Profissão", "Completar o cadastro administrativo", true, 90, true),
    ],
    schedulingPlans: [{
      key: "first_visit",
      name: "Primeira consulta",
      description: "Agenda a avaliação de bioimpedância e a consulta médica.",
      enabled: true,
      steps: [
        { key: "assessment", eventTypeKey: "bioimpedance", label: "Bioimpedância", required: true },
        { key: "consultation", eventTypeKey: "doctor_consultation", label: "Consulta Dr.", required: true },
      ],
      constraints: [{ type: "ordered", before: "assessment", after: "consultation" }],
      prerequisites: { all: [
        { field: "customer.missingFieldsCount", operator: "eq", value: 0 },
        { field: "operations.paymentStatus", operator: "eq", value: "paid" },
      ] },
      proposalExpiryMinutes: 24 * 60,
    }],
    enabledTools: [
      "customer.classify_relationship",
      "customer.update_profile",
      "payment.request_deposit",
      "calendar.find_plan_option",
      "calendar.book_plan_option",
      "calendar.list_appointments",
      "calendar.check_availability",
      "calendar.book_appointment",
      "calendar.update_appointment",
    ],
    loopPolicy: {
      maxModelIterations: 4,
      maxToolExecutions: 3,
      maxMutations: 1,
      maxRepeatedInvalidCalls: 1,
    },
    payment: { pixKey: "", recipientName: "", signalAmountCents: 10_000 },
    updatedAt: now,
    updatedBy: "system",
  };
}

function rule(
  fieldKey: string,
  label: string,
  purpose: string,
  required: boolean,
  collectionOrder: number,
  sensitive: boolean,
) {
  return { fieldKey, label, purpose, required, collectionOrder, sensitive };
}