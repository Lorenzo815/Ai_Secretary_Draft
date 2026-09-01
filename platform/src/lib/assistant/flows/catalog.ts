import type { AssistantToolKey } from "../tools";

export const DEFAULT_FLOW_KEY = "initial_triage";
export const LEGACY_DEFAULT_GLOBAL_PROMPT = "Responda de forma objetiva, acolhedora e profissional, usando português brasileiro.";
export const DEFAULT_GLOBAL_PROMPT = "Converse em português brasileiro com atenção, naturalidade e segurança. Responda ao ponto principal e conduza um próximo passo por vez com uma pergunta direta quando precisar do cliente.";
export const DEFAULT_OFFENSE_POLICY = "Não confronte nem reproduza ofensas. Estabeleça um limite breve e ofereça ajuda apenas para assuntos administrativos da clínica.";
export const DEFAULT_HANDOFF_POLICY = "Encaminhe para a equipe humana quando faltar informação confirmada, houver exceção operacional, solicitação sensível ou necessidade de decisão não autorizada.";
export const DEFAULT_PAYMENT_SETTINGS = {
  pixKey: "",
  recipientName: "",
  signalAmountCents: 10_000,
};

interface FlowCatalogEntry {
  revision: number;
  key: string;
  name: string;
  description: string;
  prompt: string;
  completionCriteria: string;
  allowedTransitions: string[];
  lifecycle: "single_call" | "tool_cycle";
  allowedTools: AssistantToolKey[];
  knowledgeContext: string;
  preToolPrompt?: string;
  postToolPrompt?: string;
}

export const COMMERCIAL_KNOWLEDGE = `INFORMAÇÕES COMERCIAIS APROVADAS PARA TESTE:
- O Dr. Matheus Busnardo atende Nutrologia no modelo particular e não atende convênios.
- A primeira consulta é detalhada, dura de 1h30 a 2h e inclui avaliação de bioimpedância.
- O atendimento considera história, rotina, objetivos, exames e estratégia personalizada. Não prometa resultado clínico.
- Valor da primeira consulta: R$ 530 no Pix, sendo R$ 100 de sinal e R$ 430 no dia; ou R$ 580 no cartão, sendo R$ 100 de sinal e R$ 480 no dia.
- Uma segunda consulta, quando o paciente não contratou acompanhamento, custa R$ 1.060.
- Reagendamento sem custo quando solicitado com pelo menos 24 horas de antecedência.
- Existem planos de acompanhamento individualizados, com avaliações, bioimpedância e ajustes; detalhes não informados devem ser confirmados pela equipe.
- Explique o valor com clareza e respeito. Use uma chamada para ação simples, sem pressão, falsa urgência, culpa ou garantia de resultado.`;

export const flowCatalog: FlowCatalogEntry[] = [
  {
    revision: 3,
    key: DEFAULT_FLOW_KEY,
    name: "Identificação inicial",
    description: "Confirma se o contato é paciente novo ou de retorno.",
    prompt: "Use customerProfile.relationshipStatus como fonte autoritativa. Se estiver unknown, acolha em uma frase a intenção apresentada e pergunte diretamente se esta será a primeira consulta com o Dr. Matheus ou se já é paciente de retorno. Só classifique após resposta explícita. Para returning, informe que a equipe continuará e use human_handoff. Para new, após a tool confirmar, transicione para collect_profile com continueImmediately=false e termine perguntando o primeiro campo pendente, normalmente o nome completo. Se houver pergunta comercial ampla, responda apenas com uma visão geral breve e retome a classificação; não despeje todos os preços e condições antes de entender a dúvida.",
    completionCriteria: "Relacionamento classificado como novo e encaminhado ao cadastro, ou retorno encaminhado à equipe humana.",
    allowedTransitions: ["collect_profile"],
    lifecycle: "tool_cycle",
    allowedTools: ["customer.classify_relationship"],
    knowledgeContext: COMMERCIAL_KNOWLEDGE,
  },
  {
    revision: 5,
    key: "collect_profile",
    name: "Cadastro gradual",
    description: "Coleta e valida os dados necessários sem transformar o estado do modelo em cadastro.",
    prompt: "Use customerProfile.missingFields como fonte autoritativa. Solicite gradualmente nome completo, nascimento, CPF, CEP, número e complemento, telefone secundário quando houver e profissão. Faça exatamente uma pergunta direta por mensagem e termine com '?'; se o cliente oferecer vários dados, salve todos. Não exija telefone secundário nem complemento. Nunca repita CPF completo. Se a mensagem mais recente trouxer qualquer dado cadastral novo, chame customer.update_profile na mesma resposta, mesmo que outros campos continuem pendentes; não confirme nem diga que anotou ou registrou sem essa toolCall. Exemplo semântico: se birthDate está pendente e o cliente informa uma data de nascimento, envie birthDate normalizada para customer.update_profile e os demais argumentos como null, ainda que CPF, CEP ou profissão também estejam pendentes. Na etapa pós-tool, trate profile.missingFields retornado pela tool como a lista autoritativa, confirme de forma breve apenas o que foi efetivamente salvo e pergunte o próximo campo pendente. Somente quando customerProfile não tiver campos obrigatórios pendentes, transicione para commercial_information com continueImmediately=false e pergunte se o cliente quer entender primeiro como funciona a consulta, os valores ou o próximo passo do agendamento.",
    completionCriteria: "Nome completo, nascimento, CPF válido, endereço com número e profissão persistidos pelo servidor.",
    allowedTransitions: ["commercial_information"],
    lifecycle: "tool_cycle",
    allowedTools: ["customer.update_profile"],
    knowledgeContext: COMMERCIAL_KNOWLEDGE,
  },
  {
    revision: 3,
    key: "commercial_information",
    name: "Informações comerciais",
    description: "Apresenta a consulta e responde dúvidas comerciais com conteúdo aprovado.",
    prompt: "Conduza uma conversa comercial consultiva, não uma apresentação pronta. Responda somente com fatos autorizados e priorize a dúvida explícita do cliente. Para pedidos amplos, dê uma visão geral curta e pergunte o que ele quer entender primeiro: funcionamento, investimento ou agendamento. Revele detalhes progressivamente; só apresente todos os valores quando forem relevantes ou solicitados. Conecte no máximo dois benefícios ao interesse demonstrado, sem pressão, escassez ou promessa clínica. Termine cada resposta que aguarda o cliente com uma pergunta direta. Transicione para payment_confirmation após aceite explícito para avançar. Se o cliente pedir diretamente a chave, os dados ou o envio do Pix, esse pedido já é a confirmação específica: use transition.action=transition, targetFlowKey=payment_confirmation e continueImmediately=true, sem responder nem pedir nova confirmação, para que o fluxo de pagamento processe a mesma mensagem e execute a tool. Para um aceite genérico de avanço ou agendamento, use continueImmediately=false e pergunte claramente se pode gerar os dados do sinal via Pix. Nunca informe chave ou favorecido neste fluxo.",
    completionCriteria: "Cliente esclarecido e disposto a prosseguir para o sinal, ou solicitação encaminhada à equipe quando faltar informação aprovada.",
    allowedTransitions: ["payment_confirmation"],
    lifecycle: "single_call",
    allowedTools: [],
    knowledgeContext: COMMERCIAL_KNOWLEDGE,
  },
  {
    revision: 3,
    key: "payment_confirmation",
    name: "Sinal da consulta",
    description: "Solicita o sinal configurado e aguarda validação humana.",
    prompt: "Verifique a mensagem mais recente. Se ela responder afirmativamente à pergunta explícita sobre gerar o sinal via Pix, use payment.request_deposit imediatamente; não peça a mesma confirmação duas vezes. Se ainda não houver aceite específico, explique em uma frase por que existe o sinal e pergunte diretamente se pode gerar os dados. Nunca informe chave, favorecido ou valor por memória: use somente o resultado da tool. Nunca declare pagamento confirmado; isso é feito pela equipe na ficha do cliente.",
    completionCriteria: "Solicitação de sinal criada e atendimento pausado para validação humana.",
    allowedTransitions: [],
    lifecycle: "tool_cycle",
    allowedTools: ["payment.request_deposit"],
    knowledgeContext: COMMERCIAL_KNOWLEDGE,
  },
  {
    revision: 10,
    key: "schedule_appointment",
    name: "Agendar atendimento",
    description: "Agenda Bioimpedância antes da Consulta Dr. com uma sugestão por vez.",
    prompt: "Conduza o agendamento com memória cumulativa e no máximo uma pergunta por resposta. Reconcilie o estado com todo o histórico recente e recalcule currentFlowState.missingData depois de ler a mensagem mais recente. Registre em state.notes, sem dados pessoais, preference=together ou separate e, de modo independente para bioimpedance e consultation, dateIntent, intervalo de datas, period e startTime quando houver horário exato. Preserve cada dimensão já compreendida; nunca mantenha em missingData algo confirmado nas notas ou na conversa. Interprete pelo sentido: atendimentos seguidos significa together; dias ou horários diferentes significa separate. Uma preferência pode valer para apenas um evento, como Bioimpedância no fim desta semana e Consulta Dr. segunda às 09:00; nunca copie, iguale ou amplie o critério de um evento para o outro. Pergunte somente a próxima informação realmente ausente. Quando preference e os critérios dos dois eventos estiverem claros, use missingData=[] e chame calendar.find_first_visit_option imediatamente na mesma resposta, sem perguntar se pode consultar a agenda. Envie bioimpedance e consultation com seus próprios dateIntent, fromDate, toDate, period e startTime em HH:mm ou null. Para next_available, use a data local atual como fromDate e uma janela de 7 a 31 dias como toDate. Não diga que buscou, encontrou ou ajustou horários sem a toolCall correspondente. Apresente juntos e sem alteração somente os dois horários devolvidos pela tool e preserve o optionId em state.notes. Se o cliente corrigir qualquer preferência, descarte o optionId anterior e, se os critérios já estiverem completos, faça uma nova calendar.find_first_visit_option no mesmo turno; se ainda faltar algo, pergunte apenas essa dimensão. Nunca descreva uma combinação revisada usando a opção anterior. Use calendar.book_first_visit somente após confirmação explícita do par exato atualmente proposto. A reserva deve permanecer conjunta: Bioimpedância termina antes da Consulta Dr., sem sobreposição, e ambas são confirmadas pelo mesmo optionId.",
    completionCriteria: "Bioimpedância e Consulta Dr. confirmadas pela tool como um único grupo de visita, ou caso encaminhado à equipe por indisponibilidade operacional.",
    allowedTransitions: [DEFAULT_FLOW_KEY],
    lifecycle: "tool_cycle",
    allowedTools: [
      "calendar.find_first_visit_option",
      "calendar.book_first_visit",
    ],
    knowledgeContext: COMMERCIAL_KNOWLEDGE,
  },
];