import "server-only";

import { ObjectId } from "mongodb";
import { DateTime } from "luxon";
import { bookAppointment, findAvailableSlots, getCalendarSettings } from "../../calendar";
import type { AssistantGeneration, CalendarAction } from "../prompt";
import type { AssistantToolKey } from "../flows";

export interface CalendarToolExecution {
  output: string;
  retryable: boolean;
}

export function getGroundedCalendarReply(output?: string) {
  if (!output) return null;
  try {
    const result = JSON.parse(output) as {
      ok?: boolean;
      type?: string;
      tool?: string;
      timezone?: string;
      startAt?: string;
      slots?: Array<{ label?: string }>;
    };
    if (result.ok && result.tool === "calendar.check_availability") {
      const labels = result.slots?.map((slot) => slot.label).filter((label): label is string => Boolean(label)) ?? [];
      if (labels.length === 0) {
        return "Não encontrei horários disponíveis nesse período. Você prefere ampliar o intervalo ou escolher outro período do dia?";
      }
      return `Encontrei estes horários disponíveis: ${joinLabels(labels)}. Qual deles você prefere?`;
    }
    if (result.ok && result.tool === "calendar.book_appointment" && result.startAt && result.timezone) {
      const startAt = DateTime.fromISO(result.startAt, { zone: "utc" })
        .setZone(result.timezone)
        .setLocale("pt-BR")
        .toFormat("dd/LL/yyyy 'às' HH:mm");
      return `Seu agendamento foi confirmado para ${startAt}.`;
    }
    if (result.type === "operational_error") {
      return "Não consegui acessar a agenda agora. Encaminhei a solicitação para continuidade pela equipe.";
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveCalendarAction(
  generation: AssistantGeneration,
  allowedTools: AssistantToolKey[],
): CalendarAction {
  const tool = getToolKey(generation.calendarAction.action);
  if (!tool || allowedTools.includes(tool)) return generation.calendarAction;
  return emptyCalendarAction();
}

export async function assertCalendarToolCall(input: {
  generation: AssistantGeneration;
  allowedTools: AssistantToolKey[];
}): Promise<CalendarToolExecution | null> {
  if (
    input.allowedTools.length === 0 ||
    input.generation.calendarAction.action !== "none" ||
    input.generation.state.missingData.length > 0 ||
    input.generation.decision === "emergency" ||
    input.generation.decision === "out_of_scope"
  ) {
    return null;
  }

  return validationError(
    "calendar",
    [{
      field: "calendarAction.action",
      code: "tool_call_required",
      message: "O fluxo de agendamento está sem dados pendentes; consulte a agenda ou solicite os dados realmente ausentes.",
    }],
  );
}

export async function executeCalendarAction(input: {
  action: CalendarAction;
  allowedTools: AssistantToolKey[];
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  messageSource: "meta" | "simulator";
}): Promise<CalendarToolExecution | null> {
  if (input.action.action === "none") return null;
  const tool = getToolKey(input.action.action);
  if (!tool || !input.allowedTools.includes(tool)) {
    return validationError("calendar", [{
      field: "calendarAction.action",
      code: "tool_not_allowed",
      message: "Esta ferramenta não está autorizada na versão atual do fluxo.",
    }]);
  }

  if (input.action.action === "check_availability") {
    const validation = await validateAvailabilityInput(input.action);
    if (validation) return validation;
    try {
      const result = await findAvailableSlots({
        fromDate: input.action.fromDate!,
        toDate: input.action.toDate!,
        period: input.action.period!,
        limit: 8,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.check_availability",
          timezone: result.settings.timezone,
          slots: result.slots,
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.check_availability", error, "Falha na consulta.");
    }
  }

  const validation = await validateBookingInput(input.action);
  if (validation) return validation;
  try {
    const appointment = await bookAppointment({
      customerId: input.customerId,
      customerName: input.customerName,
      contactPhone: input.contactPhone,
      startAt: input.action.startAt!,
      notes: input.action.notes ?? undefined,
      source: "assistant",
      messageSource: input.messageSource,
    });
    return {
      output: JSON.stringify({
        ok: true,
        tool: "calendar.book_appointment",
        booked: true,
        appointmentId: appointment._id.toString(),
        startAt: appointment.startAt.toISOString(),
        endAt: appointment.endAt.toISOString(),
        timezone: appointment.timezone,
      }),
      retryable: false,
    };
  } catch (error) {
    return operationalError("calendar.book_appointment", error, "Falha na reserva.");
  }
}

async function validateAvailabilityInput(action: CalendarAction) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  const fromDate = parseDate(action.fromDate, settings.timezone);
  const toDate = parseDate(action.toDate, settings.timezone);

  if (!action.dateIntent) {
    errors.push(required("calendarAction.dateIntent", "Informe como a data foi interpretada."));
  }
  if (!fromDate) errors.push(required("calendarAction.fromDate", "Informe a data inicial em YYYY-MM-DD."));
  if (!toDate) errors.push(required("calendarAction.toDate", "Informe a data final em YYYY-MM-DD."));
  if (!action.period) errors.push(required("calendarAction.period", "Informe morning, afternoon ou any."));

  if (fromDate && toDate) {
    const rangeDays = toDate.diff(fromDate, "days").days;
    if (rangeDays < 0) {
      errors.push(invalid("calendarAction.toDate", "A data final não pode anteceder a inicial."));
    } else if (rangeDays > 31) {
      errors.push(invalid("calendarAction.toDate", "A janela deve ter no máximo 31 dias."));
    }
    if (action.dateIntent === "exact_date" && rangeDays !== 0) {
      errors.push(invalid("calendarAction.toDate", "Para exact_date, fromDate e toDate devem ser iguais."));
    }
    if (action.dateIntent === "next_available" && rangeDays < 7) {
      errors.push(invalid("calendarAction.toDate", "Para next_available, pesquise uma janela de 7 a 31 dias."));
    }
  }

  return errors.length > 0 ? validationError("calendar.check_availability", errors) : null;
}

async function validateBookingInput(action: CalendarAction) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  const startAt = action.startAt
    ? DateTime.fromISO(action.startAt, { setZone: true })
    : null;

  if (!action.confirmedByCustomer) {
    errors.push(invalid("calendarAction.confirmedByCustomer", "A reserva exige confirmação explícita do cliente."));
  }
  if (!startAt?.isValid || !startAt.isOffsetFixed) {
    errors.push(required("calendarAction.startAt", "Informe data, hora e offset, por exemplo 2026-09-02T09:00:00-03:00."));
  } else if (startAt.setZone(settings.timezone) <= DateTime.now().setZone(settings.timezone)) {
    errors.push(invalid("calendarAction.startAt", "O horário confirmado deve estar no futuro."));
  }

  return errors.length > 0 ? validationError("calendar.book_appointment", errors) : null;
}

interface ToolValidationIssue {
  field: string;
  code: "required" | "invalid" | "tool_call_required" | "flow_not_allowed" | "tool_not_allowed";
  message: string;
}

async function validationError(tool: string, errors: ToolValidationIssue[]): Promise<CalendarToolExecution> {
  const settings = await getCalendarSettings();
  return {
    output: JSON.stringify({
      ok: false,
      type: "validation_error",
      tool,
      calendarNow: DateTime.now().setZone(settings.timezone).toISO(),
      timezone: settings.timezone,
      errors,
    }),
    retryable: true,
  };
}

function operationalError(tool: string, error: unknown, fallback: string): CalendarToolExecution {
  return {
    output: JSON.stringify({
      ok: false,
      type: "operational_error",
      tool,
      error: error instanceof Error ? error.message : fallback,
    }),
    retryable: false,
  };
}

function parseDate(value: string | null, timezone: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = DateTime.fromISO(value, { zone: timezone }).startOf("day");
  return parsed.isValid ? parsed : null;
}

function required(field: string, message: string): ToolValidationIssue {
  return { field, code: "required", message };
}

function invalid(field: string, message: string): ToolValidationIssue {
  return { field, code: "invalid", message };
}

function emptyCalendarAction(): CalendarAction {
  return {
    action: "none",
    dateIntent: null,
    fromDate: null,
    toDate: null,
    period: null,
    startAt: null,
    confirmedByCustomer: false,
    notes: null,
  };
}

function joinLabels(labels: string[]) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} ou ${labels.at(-1)}`;
}

function getToolKey(action: CalendarAction["action"]): AssistantToolKey | null {
  if (action === "check_availability") return "calendar.check_availability";
  if (action === "book_appointment") return "calendar.book_appointment";
  return null;
}