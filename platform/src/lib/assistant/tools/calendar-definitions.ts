import type { ToolDefinition } from "./contracts";

const nullableString = { type: ["string", "null"] };

export const calendarToolDefinitions = {
  "calendar.find_first_visit_option": defineTool({
    label: "Sugerir primeira consulta",
    description: "Encontra uma única combinação de Bioimpedância antes da Consulta Dr.",
    mutates: false,
    argumentsSchema: strictArguments(["dateIntent", "fromDate", "toDate", "period", "preference"], {
      dateIntent: { type: "string", enum: ["exact_date", "date_range", "next_available"] },
      fromDate: { type: "string" },
      toDate: { type: "string" },
      period: { type: "string", enum: ["morning", "afternoon", "any"] },
      preference: { type: "string", enum: ["together", "separate"] },
    }),
    promptInstructions: `calendar.find_first_visit_option exige dateIntent, fromDate e toDate em YYYY-MM-DD, período e preference=together ou separate.
- together procura Bioimpedância de 30 minutos imediatamente antes da Consulta Dr. de 90 minutos.
- separate permite dias ou horários diferentes, sempre com Bioimpedância terminando antes da consulta.
  - Para next_available, fromDate é a data local atual da agenda e toDate fica de 7 a 31 dias depois. Esse intervalo é o tamanho da janela de busca, não uma espera antes de começar a busca.
- A tool retorna somente uma sugestão e exclui opções já oferecidas. Preserve optionId em state.notes até o cliente confirmar ou rejeitar. Chame novamente apenas quando houver rejeição ou mudança de preferências.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("find_first_visit_option", context, args),
    getGroundedReply: lazyGroundedReply,
  }),
  "calendar.book_first_visit": defineTool({
    label: "Confirmar primeira consulta",
    description: "Reserva Bioimpedância e Consulta Dr. a partir de uma opção confirmada.",
    mutates: true,
    argumentsSchema: strictArguments(["optionId", "confirmedByCustomer"], {
      optionId: { type: "string" },
      confirmedByCustomer: { type: "boolean" },
    }),
    promptInstructions: `calendar.book_first_visit exige optionId retornado pela sugestão e confirmedByCustomer=true.
- Use somente quando o cliente confirmar explicitamente os dois horários da opção oferecida.
- Nunca monte horários manualmente nem reutilize uma opção recusada.`,
    execute: async (context, args) => (await import("./calendar")).executeRegisteredCalendarTool("book_first_visit", context, args),
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
    label: "Alterar evento do cliente",
    description: "Altera horário, tipo ou observações de um evento existente.",
    mutates: true,
    argumentsSchema: strictArguments(["appointmentId", "startAt", "eventType", "confirmedByCustomer", "notes"], {
      appointmentId: { type: "string" },
      startAt: nullableString,
      eventType: nullableString,
      confirmedByCustomer: { type: "boolean" },
      notes: nullableString,
    }),
    promptInstructions: `calendar.update_appointment exige appointmentId obtido por calendar.list_appointments e confirmedByCustomer=true.
- Preencha startAt e/ou eventType e/ou notes. Nunca invente appointmentId e nunca exclua eventos.`,
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
  const parsed = JSON.parse(output) as { ok?: boolean; tool?: string; type?: string; optionId?: string; preference?: string; bioimpedance?: { startAt?: string }; consultation?: { startAt?: string }; slots?: Array<{ label?: string }>; appointments?: Array<{ startAt?: string; eventTypeName?: string }>; startAt?: string; timezone?: string };
  if (parsed.ok && parsed.tool === "calendar.find_first_visit_option" && parsed.optionId && parsed.bioimpedance?.startAt && parsed.consultation?.startAt) {
    const bio = formatDateTime(parsed.bioimpedance.startAt, parsed.timezone);
    const consultation = formatDateTime(parsed.consultation.startAt, parsed.timezone);
    return parsed.preference === "together"
      ? `Minha sugestão é fazer a Bioimpedância em ${bio} e, logo depois, a Consulta com o Dr. Matheus em ${consultation}. Posso reservar os dois horários?`
      : `Minha sugestão é a Bioimpedância em ${bio} e a Consulta com o Dr. Matheus em ${consultation}. Posso reservar os dois horários?`;
  }
  if (parsed.ok && parsed.tool === "calendar.find_first_visit_option" && !parsed.optionId) {
    return "Não encontrei uma combinação disponível com essas preferências. Você gostaria de ampliar o período ou mudar entre horários juntos e separados?";
  }
  if (parsed.ok && parsed.tool === "calendar.book_first_visit" && parsed.bioimpedance?.startAt && parsed.consultation?.startAt) {
    return `Os dois horários foram confirmados: Bioimpedância em ${formatDateTime(parsed.bioimpedance.startAt, parsed.timezone)} e Consulta com o Dr. Matheus em ${formatDateTime(parsed.consultation.startAt, parsed.timezone)}.`;
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
  if (parsed.ok && parsed.tool === "calendar.update_appointment" && parsed.startAt) {
    return `Seu evento foi alterado para ${formatDateTime(parsed.startAt, parsed.timezone)}.`;
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