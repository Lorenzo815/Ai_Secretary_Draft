import type { ToolDefinition } from "./contracts";

const nullableString = { type: ["string", "null"] };

export const calendarToolDefinitions = {
  "calendar.find_slots": defineTool({
    label: "Buscar horários",
    description: "Encontra opções para um evento ou plano usando as janelas configuradas de cada recurso.",
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
- purpose=book busca um novo agendamento; purpose=reschedule busca uma nova opção para o único agendamento atual compatível identificado pelo servidor.
- A busca é somente leitura. Quando o pedido e as preferências estiverem claros, execute-a imediatamente; não peça autorização para apenas consultar horários. Confirmação explícita é exigida somente antes de calendar.book ou calendar.reschedule.
- A disponibilidade operacional vem exclusivamente da configuração: tipo de evento -> recurso -> disponibilidade semanal. Nunca informe, invente ou tente ampliar a janela de funcionamento.
- Conflitos são calculados por recurso, não pela clínica inteira. Eventos de profissionais ou recursos diferentes podem ocorrer simultaneamente; confie nos candidatos retornados e não descarte um horário apenas porque há outro tipo de atendimento no mesmo momento.
- period e preferredTime representam apenas preferências expressas pelo cliente e sempre ficam subordinados à configuração da agenda.
- Use horizonDays=1 para exact_date. Para next_available, escolha livremente um horizonte de 1 a 60 dias proporcional ao pedido; o servidor calcula a data final, portanto não calcule toDate.
- stepCriteria permite definir data, período e horário exato diferentes por etapa de um plano. Informe somente as etapas que precisam sobrescrever os filtros globais; as demais herdam dateIntent, fromDate, horizonDays e period globais. Use os stepKey presentes no plano configurado e [] quando não houver sobrescritas.
- Exemplo: para bioimpedância na terça às 18:00 e consulta na quarta de manhã, use um critério exact_date com startTime=18:00 para assessment e outro exact_date com period=morning e startTime=null para consultation. Preserve todas as restrições explícitas do cliente; não as amplie silenciosamente.
- Sem preferência explícita do cliente, prefira ranking=compact para favorecer etapas consecutivas ou próximas. compact é uma preferência suave: se não houver adjacência, ainda retorna a melhor combinação válida.
- A vontade do cliente prevalece sobre compactação. Quando ele indicar dias, períodos ou horários diferentes por etapa, preserve esses critérios e escolha earliest, latest ou closest_to_time conforme a intenção. Nunca altere critérios explícitos apenas para aproximar as etapas.
- ranking=earliest ou latest ordena cada etapa cronologicamente na ordem do plano; closest_to_time exige preferredTime; fill_gap só desempata opções que já atendem às restrições do cliente.
- O resultado retorna de um a cinco candidateId emitidos pelo servidor, com ISO 8601, data local, hora local, dia da semana e timezone. Não remonte horários manualmente.
- Mesmo que o resultado contenha mais candidatos, apresente somente uma ou duas opções por mensagem, sempre em bullets numerados e com todas as etapas de cada opção. Isso reduz a carga de decisão do cliente.
- Em uma confirmação posterior, “Opção 1” e “Opção 2” referem-se à posição em runtime.operations.activeSchedulingOption.presentedCandidates. Já “primeiro horário disponível” e “último horário disponível” referem-se, respectivamente, aos candidatos marcados com isChronologicallyEarliest e isChronologicallyLatest entre todos os candidatos internos, independentemente da ordem de ranking ou de exibição.
- Se o cliente disser apenas “a última”, use o contexto: após uma lista numerada, significa a última opção mostrada; em um pedido sobre disponibilidade, significa o horário cronologicamente mais tarde. Pergunte somente se houver ambiguidade real. Nunca tente candidatos em sequência.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("find_slots", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.book": defineTool({
    label: "Reservar horário",
    description: "Reserva um candidato de evento ou plano após confirmação explícita.",
    mutates: true,
    argumentsSchema: strictArguments(["candidateId", "confirmedByCustomer"], {
      candidateId: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.book exige candidateId retornado por calendar.find_slots com purpose=book e confirmedByCustomer=true.
- Use somente após o cliente confirmar explicitamente todas as etapas e horários daquele candidato.
- Nunca use esta ferramenta para reagendar e nunca monte horários, customerId ou IDs manualmente.
- Uma proposta expirada, substituída ou já consumida deve ser pesquisada novamente.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("book", context, args),
    getGroundedReply: lazyGroundedReply,
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
- O servidor associa o candidato aos eventos atuais do cliente e move todas as etapas juntas em uma única mutação.
- Execute exatamente uma vez para o candidato escolhido. Depois de um resultado ok=true, considere o reagendamento concluído e nunca tente outro candidateId.
- Nunca chame calendar.book antes ou depois para concluir um reagendamento; isso criaria duplicatas.
- Esta ferramenta não cancela nem exclui eventos. Pedido apenas para cancelar deve usar human_handoff sem ferramenta de agenda.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("reschedule", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
} satisfies Record<string, ToolDefinition>;

function defineTool(definition: ToolDefinition) {
  return definition;
}

function strictArguments(required: string[], properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required, properties };
}

function lazyGroundedReply(output: string) {
  const parsed = JSON.parse(output) as { ok?: boolean; tool?: string; type?: string; optionId?: string; preference?: string; planName?: string; candidates?: Array<{ steps?: Array<{ label?: string; startAt?: string; weekdayLabel?: string; localDate?: string; localTime?: string }> }>; steps?: Array<{ label?: string; startAt?: string }>; slots?: Array<{ label?: string }>; appointments?: Array<{ startAt?: string; eventTypeName?: string }>; startAt?: string; timezone?: string };
  if (parsed.ok && parsed.tool === "calendar.find_slots") {
    const candidates = parsed.candidates?.slice(0, 2).flatMap((candidate) => {
      const steps = candidate.steps?.flatMap((step) => step.startAt
        ? [`${step.label ?? "Evento"} em ${formatDateTime(step.startAt, parsed.timezone)}`]
        : []) ?? [];
      return steps.length > 0 ? [joinRequiredSteps(steps)] : [];
    }) ?? [];
    return candidates.length > 1
      ? `Encontrei estas opções:\n${candidates.map((candidate, index) => `- Opção ${index + 1}: ${candidate}`).join("\n")}\nQual delas você prefere?`
      : candidates.length === 1
        ? `Encontrei esta opção:\n- Opção 1: ${candidates[0]}\nEsse horário funciona para você?`
      : "Não encontrei horários disponíveis com essas preferências. Você gostaria de ampliar o período ou escolher outro período do dia?";
  }
  if (parsed.ok && (parsed.tool === "calendar.book" || parsed.tool === "calendar.reschedule")) {
    const labels = parsed.steps?.flatMap((step) => step.startAt
      ? [`${step.label ?? "Evento"} em ${formatDateTime(step.startAt, parsed.timezone)}`]
      : []) ?? [];
    if (labels.length > 0) {
      return parsed.tool === "calendar.book"
        ? `Seu agendamento foi confirmado: ${joinRequiredSteps(labels)}.`
        : `Seu agendamento foi alterado: ${joinRequiredSteps(labels)}.`;
    }
  }
  if (parsed.ok && parsed.tool === "calendar.find_plan_option") {
    const labels = parsed.steps?.flatMap((step) => step.startAt
      ? [`${step.label ?? "Etapa"} em ${formatDateTime(step.startAt, parsed.timezone)}`]
      : []) ?? [];
    return parsed.optionId && labels.length > 0
      ? `Minha sugestão para ${parsed.planName ?? "o atendimento"} é ${joinRequiredSteps(labels)}. Posso reservar esses horários?`
      : "Não encontrei uma combinação disponível com essas preferências. Você gostaria de ampliar o período ou flexibilizar os horários?";
  }
  if (parsed.ok && parsed.tool === "calendar.book_plan_option") {
    const labels = parsed.steps?.flatMap((step) => step.startAt
      ? [`${step.label ?? "Etapa"} em ${formatDateTime(step.startAt, parsed.timezone)}`]
      : []) ?? [];
    if (labels.length > 0) return `Seu agendamento foi confirmado: ${joinRequiredSteps(labels)}.`;
  }
  if (parsed.ok && parsed.tool === "calendar.check_availability") {
    const labels = parsed.slots?.flatMap((slot) => slot.label ? [slot.label] : []) ?? [];
    return labels.length > 0
      ? `Encontrei estes horários disponíveis: ${joinLabels(labels)}. Qual deles você prefere?`
      : "Não encontrei horários disponíveis nesse período. Você prefere ampliar o intervalo ou escolher outro período do dia?";
  }
  if (parsed.ok && parsed.tool === "calendar.list_appointments") {
    const labels = parsed.appointments?.flatMap((appointment) => appointment.startAt
      ? [`${appointment.eventTypeName ?? "Evento"} em ${formatDateTime(appointment.startAt, parsed.timezone)}`]
      : []) ?? [];
    return labels.length > 0 ? `Encontrei: ${joinLabels(labels)}.` : "Não encontrei eventos seus com esses filtros.";
  }
  if (parsed.ok && parsed.tool === "calendar.book_appointment" && parsed.startAt) {
    return `Seu agendamento foi confirmado para ${formatDateTime(parsed.startAt, parsed.timezone)}.`;
  }
  if (parsed.ok && parsed.tool === "calendar.update_appointment") {
    const labels = parsed.appointments?.flatMap((appointment) => appointment.startAt
      ? [`${appointment.eventTypeName ?? "Evento"} em ${formatDateTime(appointment.startAt, parsed.timezone)}`]
      : []) ?? [];
    if (labels.length > 0) return `Seu agendamento foi alterado: ${joinRequiredSteps(labels)}.`;
  }
  if (parsed.type === "operational_error") {
    return "Não consegui acessar a agenda agora. Vou precisar que a equipe continue esta solicitação.";
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

function joinLabels(labels: string[]) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} ou ${labels.at(-1)}`;
}

function joinRequiredSteps(labels: string[]) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}