import type { ToolDefinition } from "./contracts";

const nullableString = { type: ["string", "null"] };
const planCriteria = strictArguments(["stepKey", "dateIntent", "fromDate", "toDate", "period", "startTime"], {
  stepKey: { type: "string" },
  dateIntent: { type: "string", enum: ["exact_date", "date_range", "next_available"] },
  fromDate: { type: "string" },
  toDate: { type: "string" },
  period: { type: "string", enum: ["morning", "afternoon", "any"] },
  startTime: nullableString,
});
const appointmentUpdate = strictArguments(["appointmentId", "startAt", "eventType", "notes"], {
  appointmentId: { type: "string" },
  startAt: nullableString,
  eventType: nullableString,
  notes: nullableString,
});

export const calendarToolDefinitions = {
  "calendar.find_plan_option": defineTool({
    label: "Sugerir plano de agendamento",
    description: "Encontra uma combinação que respeita as etapas e restrições de um plano configurado.",
    mutates: false,
    argumentsSchema: strictArguments(["planKey", "preference", "criteria"], {
      planKey: { type: "string" },
      preference: { type: "string", enum: ["compact", "flexible"] },
      criteria: { type: "array", minItems: 1, maxItems: 10, items: planCriteria },
    }),
    promptInstructions: `calendar.find_plan_option exige planKey, preference e um critério independente para cada etapa obrigatória do plano.
- Use preference=compact quando o cliente quiser etapas consecutivas e flexible quando aceitar intervalos, dias ou horários diferentes.
- Cada item de criteria usa o stepKey do plano, dateIntent, fromDate, toDate, period e startTime.
- As restrições configuradas do plano são obrigatórias e validadas pelo servidor.
- Para next_available, use a data local atual e uma janela entre 7 e 31 dias.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("find_plan_option", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.book_plan_option": defineTool({
    label: "Confirmar plano de agendamento",
    description: "Reserva todas as etapas de uma proposta de plano confirmada pelo cliente.",
    mutates: true,
    argumentsSchema: strictArguments(["optionId", "confirmedByCustomer"], {
      optionId: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.book_plan_option exige optionId e confirmedByCustomer=true.
- Use somente após confirmação explícita de todas as etapas e horários da proposta ativa.
- Nunca monte horários manualmente nem reutilize uma proposta recusada, expirada ou criada sob regras antigas.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("book_plan_option", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.list_appointments": defineTool({
    label: "Consultar eventos do cliente",
    description: "Lista eventos do cliente atual dentro de um período.",
    mutates: false,
    argumentsSchema: strictArguments(["fromDate", "toDate", "eventTypes"], {
      fromDate: { type: "string" },
      toDate: { type: "string" },
      eventTypes: { type: "array", items: { type: "string" }, maxItems: 20 },
    }),
    promptInstructions: `calendar.list_appointments exige fromDate e toDate em YYYY-MM-DD.
- A consulta é sempre limitada ao cliente atual. Use eventTypes para filtrar por zero ou mais chaves; array vazio inclui todos os tipos.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("list_appointments", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.check_availability": defineTool({
    label: "Consultar disponibilidade",
    description: "Consulta horários disponíveis por período e tipo de evento.",
    mutates: false,
    argumentsSchema: strictArguments(["dateIntent", "fromDate", "toDate", "period", "eventType"], {
      dateIntent: { type: "string", enum: ["exact_date", "date_range", "next_available"] },
      fromDate: { type: "string" },
      toDate: { type: "string" },
      period: { type: "string", enum: ["morning", "afternoon", "any"] },
      eventType: { type: "string" },
    }),
    promptInstructions: `calendar.check_availability exige dateIntent, fromDate, toDate, period e eventType.
- exact_date usa datas iguais em YYYY-MM-DD; date_range usa intervalo explícito; next_available usa janela de 7 a 31 dias.
- period deve ser morning, afternoon ou any. Converta expressões do cliente usando a data atual da agenda.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("check_availability", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.book_appointment": defineTool({
    label: "Confirmar agendamento",
    description: "Cria um agendamento após confirmação explícita do cliente.",
    mutates: true,
    argumentsSchema: strictArguments(["eventType", "startAt", "confirmedByCustomer", "notes"], {
      eventType: { type: "string" },
      startAt: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
      notes: nullableString,
    }),
    promptInstructions: `calendar.book_appointment exige eventType, startAt ISO 8601 com offset e confirmedByCustomer=true.
- Use somente após o cliente confirmar um horário exato retornado pela agenda.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("book_appointment", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.update_appointment": defineTool({
    label: "Alterar eventos do cliente",
    description: "Altera horário, tipo ou observações de um ou mais eventos existentes em uma única operação.",
    mutates: true,
    argumentsSchema: strictArguments(["appointments", "confirmedByCustomer"], {
      appointments: { type: "array", minItems: 1, maxItems: 10, items: appointmentUpdate },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.update_appointment exige appointments e confirmedByCustomer=true.
- Cada item exige appointmentId obtido por calendar.list_appointments no job atual; nunca use placeholders como "unknown" e nunca invente IDs.
- Inclua em uma única chamada todos os eventos confirmados para remarcação, preenchendo startAt e/ou eventType e/ou notes.
- Reagendamento altera eventos existentes: nunca use calendar.book_appointment ou calendar.book_plan_option para reagendar, pois criariam duplicatas.
- Para remarcar um plano com várias etapas, proponha a combinação com calendar.find_plan_option; após a confirmação, liste os eventos existentes e atualize todos de uma vez.
- Esta ferramenta não cancela nem exclui eventos. Pedido para apenas desmarcar ou cancelar deve ser encaminhado à equipe sem chamar ferramenta de agenda.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("update_appointment", context, args),
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
  const parsed = JSON.parse(output) as { ok?: boolean; tool?: string; type?: string; optionId?: string; preference?: string; planName?: string; steps?: Array<{ label?: string; startAt?: string }>; slots?: Array<{ label?: string }>; appointments?: Array<{ startAt?: string; eventTypeName?: string }>; startAt?: string; timezone?: string };
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
    return "Não consegui acessar a agenda agora. Encaminhei a solicitação para continuidade pela equipe.";
  }
  return null;
}

function formatDateTime(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
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