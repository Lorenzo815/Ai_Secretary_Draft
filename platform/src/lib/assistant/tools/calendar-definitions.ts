import type { ToolDefinition } from "./contracts";

const nullableString = { type: ["string", "null"] };

export const calendarToolDefinitions = {
  "calendar.list_appointments": defineTool({
    label: "Consultar meus agendamentos",
    description: "Consulta os próximos agendamentos e reservas temporárias válidas do cliente desta conversa, inclusive tipos que a IA não pode agendar, sem alterar a agenda.",
    mutates: false,
    argumentsSchema: strictArguments([], {}),
    promptInstructions: `calendar.list_appointments consulta os agendamentos futuros e reservas temporárias válidas do cliente desta execução e recebe somente {}.
- Use quando o cliente perguntar quais atendimentos já tem marcados ou a data e o horário da própria consulta. Não use calendar.find_slots para responder quais horários já estão agendados.
- O servidor fixa a identidade do cliente, o instante atual, o fuso e o limite de 50 resultados em ordem cronológica. A leitura inclui todos os tipos de compromisso desse cliente, independentemente da permissão para agendar. Nunca envie IDs, telefone, e-mail, datas, filtros ou qualquer outro argumento.
- A consulta é somente leitura e não exige confirmação, cadastro completo, pagamento nem pré-requisitos dos planos. Não cria propostas, reservas ou alterações.
- O resultado inclui status=scheduled, com confirmação confirmada, pendente ou não informada, e status=held somente enquanto holdExpiresAt estiver no futuro. Todos precisam ter início igual ou posterior à consulta. Eventos em andamento, concluídos, cancelados e reservas expiradas são excluídos.
- status=scheduled significa agendado, não necessariamente presença confirmada. Informe confirmationStatus=confirmed como confirmado, pending como aguardando confirmação e null como confirmação não informada. status=held significa reserva temporária aguardando sinal; informe o vencimento retornado e não a apresente como agendamento confirmado.
- withinAgentSchedulingScope informa somente se o tipo está autorizado para agendamento pela IA. false não impede informar esse compromisso, mas impede buscar ou executar seu reagendamento automático. true não dispensa as demais validações, disponibilidade e confirmação explícita.
- Use os nomes, profissionais, datas e horários locais retornados. Não exponha IDs internos nem infira compromissos ocultos ou de outras pessoas.
- appointments=[] significa que não foram encontrados agendamentos futuros ou reservas válidas para esse cliente. Se hasMore=true, informe que a lista está limitada e não a apresente como completa.
- Esta ferramenta apenas informa os horários atuais; não muda o fluxo de reagendamento. Para buscar novos horários, use calendar.find_slots com purpose=reschedule e, após confirmação explícita, calendar.reschedule uma única vez.
- Nunca use calendar.hold, payment.request_deposit ou calendar.book no mesmo reagendamento. A consulta não seleciona nem autoriza IDs de eventos.
- Vários compromissos na listagem não são um erro. Informe os resultados relevantes; a identificação do alvo de um reagendamento ocorre separadamente no servidor durante calendar.find_slots.`,
    execute: async (context, args) => (await import("./calendar")).executeUpcomingAppointmentsTool(context, args),
  }),
  "calendar.find_slots": defineTool({
    label: "Buscar horários",
    description: "Encontra opções para um evento ou plano usando expediente, permissões, bloqueios e ocupações de cada recurso.",
    mutates: false,
    argumentsSchema: strictArguments(["purpose", "eventType", "planKey", "dateIntent", "fromDate", "horizonDays", "period", "preferredTime", "ranking", "candidateCount", "stepCriteria"], {
      purpose: { type: "string", enum: ["book", "reschedule"] },
      eventType: nullableString,
      planKey: nullableString,
      dateIntent: { type: "string", enum: ["exact_date", "date_range", "next_available"] },
      fromDate: { type: "string" },
      horizonDays: { type: "integer", minimum: 1, maximum: 60 },
      period: { type: "string", enum: ["morning", "afternoon", "any"] },
      preferredTime: nullableString,
      ranking: { type: "string", enum: ["earliest", "latest", "compact", "closest_to_time", "fill_gap"] },
      candidateCount: { type: "integer", minimum: 1, maximum: 5 },
      stepCriteria: {
        type: "array",
        maxItems: 10,
        items: strictArguments(["stepKey", "dateIntent", "fromDate", "horizonDays", "period", "startTime"], {
          stepKey: { type: "string" },
          dateIntent: { type: "string", enum: ["exact_date", "date_range", "next_available"] },
          fromDate: { type: "string" },
          horizonDays: { type: "integer", minimum: 1, maximum: 60 },
          period: { type: "string", enum: ["morning", "afternoon", "any"] },
          startTime: nullableString,
        }),
      },
    }),
    promptInstructions: `calendar.find_slots busca um evento (eventType) ou um plano (planKey), nunca ambos.
- purpose=book busca opções para um novo agendamento. purpose=reschedule busca horários de destino para mover um compromisso existente; o servidor identifica o agendamento ou grupo compatível do cliente e vincula esse alvo aos candidatos retornados.
- Para consultar horários já agendados, use calendar.list_appointments quando habilitada. purpose=reschedule busca novos horários, não é uma listagem dos compromissos atuais.
- calendar.list_appointments é opcional: não precisa ser chamada antes de uma busca ou reagendamento quando a intenção e o tipo ou plano já estiverem claros.
- O reagendamento exige um único agendamento ou grupo compatível identificado pelo servidor. Se houver erro em currentAppointments, esclareça o tipo ou plano quando isso puder resolver a ambiguidade; se ela persistir, use human_handoff. Não escolha eventos pela posição na listagem nem invente um argumento de seleção.
- A busca é somente leitura. Quando o pedido e as preferências estiverem claros, execute-a imediatamente; não peça autorização para apenas consultar horários. Confirmação explícita é exigida somente antes de calendar.hold, calendar.book ou calendar.reschedule.
- Consulte horários mesmo que cadastro, pagamento ou outros pré-requisitos do plano ainda estejam pendentes. Os pré-requisitos são obrigatórios para confirmar a operação quando aplicáveis, não para visualizar disponibilidade; calendar.hold permite uma reserva temporária antes do sinal.
- A disponibilidade operacional vem exclusivamente da configuração: tipo de evento -> recurso -> expediente semanal intersectado com uma permissão aplicável, menos bloqueios e agendamentos existentes. Uma permissão não amplia o expediente semanal; qualquer bloqueio aplicável prevalece. Nunca informe, invente ou tente ampliar uma janela retornada.
- Permissões e bloqueios podem valer para todos os profissionais ou somente para recursos selecionados. Confie exclusivamente nos candidatos retornados pelo servidor.
- Conflitos são calculados por recurso, não pela clínica inteira. Eventos de profissionais ou recursos diferentes podem ocorrer simultaneamente; confie nos candidatos retornados e não descarte um horário apenas porque há outro tipo de atendimento no mesmo momento.
- period e preferredTime representam apenas preferências expressas pelo cliente e sempre ficam subordinados à configuração da agenda.
- Use horizonDays=1 para exact_date. Para next_available, escolha livremente um horizonte de 1 a 60 dias proporcional ao pedido; o servidor calcula a data final, portanto não calcule toDate.
- stepCriteria permite definir data, período e horário exato diferentes por etapa de um plano. Informe somente as etapas que precisam sobrescrever os filtros globais; as demais herdam dateIntent, fromDate, horizonDays e period globais. Use os stepKey presentes no plano configurado e [] quando não houver sobrescritas.
- Exemplo: para bioimpedância na terça às 18:00 e consulta na quarta de manhã, use um critério exact_date com startTime=18:00 para assessment e outro exact_date com period=morning e startTime=null para consultation. Preserve todas as restrições explícitas do cliente; não as amplie silenciosamente.
- Sem preferência explícita do cliente, prefira ranking=compact para favorecer etapas consecutivas ou próximas. compact é uma preferência suave: se não houver adjacência, ainda retorna a melhor combinação válida.
- A vontade do cliente prevalece sobre compactação. Quando ele indicar dias, períodos ou horários diferentes por etapa, preserve esses critérios e escolha earliest, latest ou closest_to_time conforme a intenção. Nunca altere critérios explícitos apenas para aproximar as etapas.
- ranking=earliest ou latest ordena cada etapa cronologicamente na ordem do plano; closest_to_time exige preferredTime; fill_gap só desempata opções que já atendem às restrições do cliente.
- Um único ranking não representa extremos opostos em etapas diferentes. Quando buscas avulsas forem permitidas pelas regras do atendimento, descubra os extremos necessários com buscas separadas por eventType; depois fixe em stepCriteria o extremo já descoberto e faça a busca final do plano com o ranking da etapa restante. Para primeira avaliação + última consulta, fixe o startTime da consulta e use ranking=earliest na busca final. Se o atendimento exigir pesquisar sempre o plano completo, preserve essa regra e esclareça a prioridade do cliente em vez de pesquisar etapas isoladas.
- Cada nova busca do mesmo plano substitui as propostas anteriores. Depois de descobrir horários separadamente, sempre faça a busca final do plano e apresente somente os candidateId retornados por ela.
- O resultado retorna de um a cinco candidateId emitidos pelo servidor, com ISO 8601, data local, hora local, dia da semana e timezone. Não remonte horários manualmente.
- Responda à pergunta concreta do cliente usando os resultados como dados, sem repetir uma fórmula fixa. Se ele perguntou apenas se há atendimento em uma data ou período, responda isso antes de propor qualquer próximo passo.
- Apresente somente as opções necessárias para a decisão atual, mantendo a ordem e os candidateId retornados. Use bullets numerados quando apresentar mais de uma opção e inclua todas as etapas de cada opção.
- Um resultado sem candidatos responde somente aos critérios aplicados. Não amplie data, período, horário ou tipo de evento na mesma execução. Informe apenas que não encontrou horários com os filtros pedidos e pergunte qual restrição o cliente aceita flexibilizar.
- Um resultado vazio retorna unavailability.cause=undetermined porque a busca combinada não diagnostica qual etapa causou a ausência. Nunca diga que uma etapa ou profissional específico “não tem vaga”, “só abre” em certo horário ou causou o conflito sem um campo explícito que prove isso.
- Em uma confirmação posterior, “Opção 1” e “Opção 2” referem-se à posição em runtime.operations.activeSchedulingOption.presentedCandidates.
- isChronologicallyEarliest e isChronologicallyLatest comparam somente o lote limitado de candidatos da busca atual. Nunca use essas marcas para afirmar que encontrou o primeiro ou o último horário de toda a agenda; para extremos globais, execute a busca com ranking=earliest ou ranking=latest adequado.
- Se o cliente disser apenas “a última”, use o contexto: após uma lista numerada, significa a última opção mostrada; em um pedido sobre disponibilidade, significa o horário cronologicamente mais tarde. Pergunte somente se houver ambiguidade real. Nunca tente candidatos em sequência.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("find_slots", context, args),
    getGroundedReply: getCalendarResultOverride,
  }),
  "calendar.book": defineTool({
    label: "Confirmar agendamento",
    description: "Confirma um candidato após a escolha explícita e o atendimento aos pré-requisitos aplicáveis ao plano.",
    mutates: true,
    argumentsSchema: strictArguments(["candidateId", "confirmedByCustomer"], {
      candidateId: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.book exige candidateId retornado por calendar.find_slots com purpose=book e confirmedByCustomer=true.
- Use somente após o cliente confirmar explicitamente todas as etapas e horários daquele candidato.
- O servidor valida os pré-requisitos aplicáveis. Se houver uma reserva temporária aguardando sinal, não chame calendar.book: a confirmação do pagamento promove essa reserva automaticamente.
- Nunca use esta ferramenta para reagendar e nunca monte horários, customerId ou IDs manualmente.
- Uma proposta expirada, substituída ou já consumida deve ser pesquisada novamente.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("book", context, args),
    getGroundedReply: getCalendarResultOverride,
  }),
  "calendar.hold": defineTool({
    label: "Reservar enquanto aguarda sinal",
    description: "Bloqueia temporariamente uma opção escolhida pelo cliente até o sinal ser confirmado ou o prazo configurado expirar.",
    mutates: true,
    argumentsSchema: strictArguments(["candidateId", "confirmedByCustomer"], {
      candidateId: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.hold exige candidateId retornado por calendar.find_slots com purpose=book e confirmedByCustomer=true.
- Use somente para um plano ativo configurado, quando o cliente escolher explicitamente uma opção completa e o sinal ainda não estiver confirmado. Esta ferramenta não aceita candidatos de eventos avulsos.
- Não bloqueie todas as opções apresentadas. Bloqueie apenas o candidateId escolhido pelo cliente.
- Esta ferramenta cria uma reserva temporária pelo prazo configurado no plano. Ela não confirma o agendamento e não substitui o pagamento.
- Informe o vencimento usando holdExpiresAt retornado pelo servidor, no fuso da clínica; nunca presuma uma duração fixa.
- Depois de uma reserva bem-sucedida, complete os dados obrigatórios configurados e prossiga com payment.request_deposit quando o cliente já tiver aceitado pagar; caso contrário, explique o prazo da reserva e peça confirmação para emitir o sinal.
- Se o sinal já estiver pago, não use esta ferramenta. Use calendar.book somente se não houver reserva temporária da opção; uma opção já reservada é promovida automaticamente após o pagamento.
- Nunca use para reagendamento, nunca monte IDs ou horários manualmente e nunca afirme que o agendamento está confirmado enquanto o resultado estiver apenas reservado.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("hold", context, args),
  }),
  "calendar.reschedule": defineTool({
    label: "Reagendar horário",
    description: "Move o evento ou grupo existente para um candidato confirmado, sem criar duplicatas.",
    mutates: true,
    argumentsSchema: strictArguments(["candidateId", "confirmedByCustomer"], {
      candidateId: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.reschedule exige candidateId retornado por calendar.find_slots com purpose=reschedule e confirmedByCustomer=true.
- calendar.list_appointments é uma consulta opcional dos horários atuais: não substitui a busca de um candidato com purpose=reschedule nem a identificação dos eventos pelo servidor.
- O servidor associa o candidato aos eventos atuais do cliente e move todas as etapas juntas em uma única mutação.
- Pode mover agendamentos e reservas temporárias ainda válidas, desde que o tipo ou plano esteja autorizado para agendamento pela IA. A leitura de um compromisso fora desse escopo não concede permissão para alterá-lo.
- Em uma reserva com sinal pendente, preserve a cobrança e o status temporário. O servidor renova o prazo configurado a partir do reagendamento, limitado ao início da primeira etapa. Use o novo holdExpiresAt retornado e não afirme confirmação definitiva; não exija pagamento prévio para apenas mover essa reserva existente.
- Confirme explicitamente com o cliente todas as novas etapas e horários antes de executar. Para um alvo já agendado, o servidor continua validando os pré-requisitos configurados; mover uma reserva existente ainda aguardando sinal não exige os pré-requisitos de confirmação definitiva. Uma pendência não autoriza criar uma cobrança dentro deste fluxo.
- Execute exatamente uma vez para o candidato escolhido. Depois de um resultado ok=true, considere o reagendamento concluído e nunca tente outro candidateId.
- Nunca chame calendar.book antes ou depois para concluir um reagendamento; isso criaria duplicatas.
- Nunca use calendar.hold ou payment.request_deposit no mesmo reagendamento.
- Esta ferramenta não cancela nem exclui eventos. Pedido apenas para cancelar deve usar human_handoff sem ferramenta de agenda.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("reschedule", context, args),
    getGroundedReply: getCalendarResultOverride,
  }),
} satisfies Record<string, ToolDefinition>;

function defineTool(definition: ToolDefinition) {
  return definition;
}

function strictArguments(required: string[], properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required, properties };
}

function getCalendarResultOverride(output: string) {
  const parsed = JSON.parse(output) as {
    ok?: boolean;
    tool?: string;
    type?: string;
    steps?: Array<{ label?: string; startAt?: string }>;
    timezone?: string;
    status?: "scheduled" | "held";
    holdExpiresAt?: string | null;
  };
  if (parsed.ok && (parsed.tool === "calendar.book" || parsed.tool === "calendar.reschedule")) {
    const labels = parsed.steps?.flatMap((step) => step.startAt
      ? [`${step.label ?? "Evento"} em ${formatDateTime(step.startAt, parsed.timezone)}`]
      : []) ?? [];
    if (labels.length > 0) {
      if (parsed.tool === "calendar.reschedule" && parsed.status === "held") {
        return `Sua reserva temporária foi alterada: ${joinRequiredSteps(labels)}. Ela continua aguardando o sinal${parsed.holdExpiresAt ? ` e vence em ${formatDateTime(parsed.holdExpiresAt, parsed.timezone)}` : ""}.`;
      }
      return parsed.tool === "calendar.book"
        ? `Seu agendamento foi confirmado: ${joinRequiredSteps(labels)}.`
        : `Seu agendamento foi alterado: ${joinRequiredSteps(labels)}.`;
    }
  }
  if (parsed.type === "operational_error") {
    return parsed.tool === "calendar.find_slots"
      ? "Não consegui consultar a agenda agora. Você pode tentar novamente em alguns minutos."
      : "Não consegui confirmar o resultado na agenda agora. Para evitar duplicidade, não repetirei a operação automaticamente.";
  }
  return null;
}

function formatDateTime(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function joinRequiredSteps(labels: string[]) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}