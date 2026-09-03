import "server-only";

import { ObjectId } from "mongodb";
import { DateTime } from "luxon";
import { bookAppointment, findAvailableSlots, findCustomerAppointments, getCalendarSettings, updateCustomerAppointment } from "../../calendar";
import { bookSchedulingPlanOption, findSchedulingPlanOption, getActiveSchedulingPlanOption } from "../../calendar/plans";
import { matchesConditions } from "../../automation/conditions";
import { findCustomerById, getCustomerProfileSnapshot } from "../../crm";
import { getLatestPaymentRequest } from "../../payments";
import type { AgentConfigurationDocument, SchedulingPlan } from "../agent/contracts";
import { getConfiguredMissingFields } from "../agent/runtime-context";
import type { ToolExecution, ToolExecutionContext } from "./contracts";

interface CalendarToolArguments {
  action: "find_plan_option" | "book_plan_option" | "list_appointments" | "check_availability" | "book_appointment" | "update_appointment";
  dateIntent: "exact_date" | "date_range" | "next_available" | null;
  fromDate: string | null;
  toDate: string | null;
  period: "morning" | "afternoon" | "any" | null;
  appointmentId: string | null;
  optionId: string | null;
  eventType: string | null;
  eventTypes: string[];
  startAt: string | null;
  confirmedByCustomer: boolean;
  notes: string | null;
  planKey: string | null;
  planPreference: "compact" | "flexible" | null;
  criteria: PlanToolCriteria[];
}

interface PlanSearchCriteria {
  dateIntent: "exact_date" | "date_range" | "next_available";
  fromDate: string;
  toDate: string;
  period: "morning" | "afternoon" | "any";
  startTime: string | null;
}

interface PlanToolCriteria extends PlanSearchCriteria {
  stepKey: string;
}

async function executeCalendarAction(input: {
  action: CalendarToolArguments;
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  activeSchedulingOptionId?: string;
  configuration: AgentConfigurationDocument;
}): Promise<ToolExecution | null> {
  if (input.action.action === "find_plan_option") {
    const configuration = input.configuration;
    const plan = configuration.schedulingPlans.find((item) => item.enabled && item.key === input.action.planKey);
    if (!plan) return validationError("calendar.find_plan_option", [invalid("arguments.planKey", "Informe um plano de agenda habilitado.")]);
    const prerequisiteError = await validatePlanPrerequisites(input.customerId, plan, configuration);
    if (prerequisiteError) return prerequisiteError;
    const validation = await validatePlanAvailability(input.action, plan);
    if (validation) return validation;
    try {
      const result = await findSchedulingPlanOption({
        customerId: input.customerId,
        plan,
        configRevision: configuration.revision,
        preference: input.action.planPreference!,
        criteria: input.action.criteria,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.find_plan_option",
          timezone: result.settings.timezone,
          optionId: result.option?._id.toString() ?? null,
          planKey: plan.key,
          planName: plan.name,
          preference: result.option?.preference ?? input.action.planPreference,
          steps: result.option?.steps.map((step) => ({
            stepKey: step.stepKey,
            eventTypeKey: step.eventTypeKey,
            label: plan.steps.find((definition) => definition.key === step.stepKey)?.label ?? step.stepKey,
            startAt: step.slot.startAt,
            endAt: step.slot.endAt,
          })) ?? [],
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.find_plan_option", error, "Falha na consulta do plano de agenda.");
    }
  }

  if (input.action.action === "book_plan_option") {
    if (!input.action.optionId || !ObjectId.isValid(input.action.optionId) || !input.action.confirmedByCustomer) {
      return validationError("calendar.book_plan_option", [
        invalid("arguments", "Informe optionId válido e confirmação explícita do cliente."),
      ]);
    }
    if (input.action.optionId !== input.activeSchedulingOptionId) {
      return validationError("calendar.book_plan_option", [
        invalid("optionId", "A opção confirmada não é a proposta atual. Consulte novamente a agenda."),
      ]);
    }
    const configuration = input.configuration;
    const activeOption = await getActiveSchedulingPlanOption(input.customerId, new ObjectId(input.action.optionId));
    const plan = configuration.schedulingPlans.find((item) => item.enabled && item.key === activeOption?.planKey);
    if (!activeOption || !plan) {
      return validationError("calendar.book_plan_option", [invalid("optionId", "A proposta não usa um plano ativo.")]);
    }
    const prerequisiteError = await validatePlanPrerequisites(input.customerId, plan, configuration);
    if (prerequisiteError) return prerequisiteError;
    try {
      const result = await bookSchedulingPlanOption({
        customerId: input.customerId,
        customerName: input.customerName,
        contactPhone: input.contactPhone,
        optionId: new ObjectId(input.action.optionId),
        plan,
        configRevision: configuration.revision,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.book_plan_option",
          appointmentGroupId: result.appointmentGroupId.toString(),
          timezone: result.settings.timezone,
          planKey: plan.key,
          planName: plan.name,
          steps: result.option.steps.map((step) => ({
            stepKey: step.stepKey,
            eventTypeKey: step.eventTypeKey,
            label: plan.steps.find((definition) => definition.key === step.stepKey)?.label ?? step.stepKey,
            startAt: step.slot.startAt,
            endAt: step.slot.endAt,
          })),
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.book_plan_option", error, "Falha na reserva do plano de agenda.");
    }
  }

  if (input.action.action === "check_availability") {
    const validation = await validateAvailabilityInput(input.action);
    if (validation) return validation;
    try {
      const result = await findAvailableSlots({
        fromDate: input.action.fromDate!,
        toDate: input.action.toDate!,
        period: input.action.period!,
        eventType: input.action.eventType!,
        limit: 8,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.check_availability",
          timezone: result.settings.timezone,
          eventType: input.action.eventType,
          eventTypeName: result.settings.eventTypes.find((item) => item.key === input.action.eventType)?.name,
          eventTypes: serializeEventTypes(result.settings.eventTypes),
          slots: result.slots,
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.check_availability", error, "Falha na consulta.");
    }
  }

  if (input.action.action === "list_appointments") {
    const validation = await validateListInput(input.action);
    if (validation) return validation;
    try {
      const result = await findCustomerAppointments({
        customerId: input.customerId,
        fromDate: input.action.fromDate!,
        toDate: input.action.toDate!,
        eventTypes: input.action.eventTypes,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.list_appointments",
          timezone: result.settings.timezone,
          eventTypes: serializeEventTypes(result.settings.eventTypes),
          appointments: result.appointments.map((appointment) => ({
            appointmentId: appointment._id.toString(),
            startAt: appointment.startAt.toISOString(),
            endAt: appointment.endAt.toISOString(),
            eventType: appointment.eventType,
            eventTypeName: result.settings.eventTypes.find((item) => item.key === appointment.eventType)?.name ?? "Tipo removido",
            notes: appointment.notes ?? null,
          })),
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.list_appointments", error, "Falha na consulta de eventos.");
    }
  }

  if (input.action.action === "update_appointment") {
    const validation = await validateUpdateInput(input.action);
    if (validation) return validation;
    try {
      const appointment = await updateCustomerAppointment({
        appointmentId: new ObjectId(input.action.appointmentId!),
        customerId: input.customerId,
        startAt: input.action.startAt ?? undefined,
        eventType: input.action.eventType ?? undefined,
        notes: input.action.notes ?? undefined,
      });
      const settings = await getCalendarSettings();
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.update_appointment",
          appointmentId: appointment._id.toString(),
          startAt: appointment.startAt.toISOString(),
          endAt: appointment.endAt.toISOString(),
          eventType: appointment.eventType,
          eventTypeName: settings.eventTypes.find((item) => item.key === appointment.eventType)?.name ?? "Tipo removido",
          eventTypes: serializeEventTypes(settings.eventTypes),
          timezone: appointment.timezone,
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.update_appointment", error, "Falha na alteração.");
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
      eventType: input.action.eventType!,
      notes: input.action.notes ?? undefined,
      source: "assistant",
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
        eventType: appointment.eventType,
      }),
      retryable: false,
    };
  } catch (error) {
    return operationalError("calendar.book_appointment", error, "Falha na reserva.");
  }
}

async function validateAvailabilityInput(action: CalendarToolArguments) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  const fromDate = parseDate(action.fromDate, settings.timezone);
  const toDate = parseDate(action.toDate, settings.timezone);

  if (!action.dateIntent) {
    errors.push(required("arguments.dateIntent", "Informe como a data foi interpretada."));
  }
  if (!fromDate) errors.push(required("arguments.fromDate", "Informe a data inicial em YYYY-MM-DD."));
  if (!toDate) errors.push(required("arguments.toDate", "Informe a data final em YYYY-MM-DD."));
  if (!action.period) errors.push(required("arguments.period", "Informe morning, afternoon ou any."));
  validateEventType(action.eventType, settings, errors, "arguments.eventType");

  if (fromDate && toDate) {
    const rangeDays = toDate.diff(fromDate, "days").days;
    if (rangeDays < 0) {
      errors.push(invalid("arguments.toDate", "A data final não pode anteceder a inicial."));
    } else if (rangeDays > 31) {
      errors.push(invalid("arguments.toDate", "A janela deve ter no máximo 31 dias."));
    }
    if (action.dateIntent === "exact_date" && rangeDays !== 0) {
      errors.push(invalid("arguments.toDate", "Para exact_date, fromDate e toDate devem ser iguais."));
    }
    if (action.dateIntent === "next_available" && rangeDays < 7) {
      errors.push(invalid("arguments.toDate", "Para next_available, pesquise uma janela de 7 a 31 dias."));
    }
  }

  return errors.length > 0 ? validationError("calendar.check_availability", errors) : null;
}

async function validatePlanAvailability(action: CalendarToolArguments, plan: SchedulingPlan) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  if (!action.planPreference) errors.push(required("arguments.preference", "Informe compact ou flexible."));
  const criteriaByStep = new Map(action.criteria.map((criterion) => [criterion.stepKey, criterion]));
  for (const step of plan.steps.filter((item) => item.required)) {
    const criterion = criteriaByStep.get(step.key);
    if (!criterion) {
      errors.push(required(`arguments.criteria.${step.key}`, `Informe os critérios de ${step.label}.`));
      continue;
    }
    validatePlanCriterion(criterion, settings.timezone, errors);
    validateEventType(step.eventTypeKey, settings, errors, `plan.steps.${step.key}.eventTypeKey`);
  }
  if (criteriaByStep.size !== action.criteria.length || action.criteria.some((criterion) => !plan.steps.some((step) => step.key === criterion.stepKey))) {
    errors.push(invalid("arguments.criteria", "Use cada stepKey configurado no plano no máximo uma vez."));
  }
  return errors.length > 0 ? validationError("calendar.find_plan_option", errors) : null;
}

function validatePlanCriterion(
  criterion: PlanToolCriteria,
  timezone: string,
  errors: ToolValidationIssue[],
) {
  const fromDate = parseDate(criterion.fromDate, timezone);
  const toDate = parseDate(criterion.toDate, timezone);
  if (!fromDate || !toDate) {
    errors.push(required(`arguments.criteria.${criterion.stepKey}`, "Informe datas válidas em YYYY-MM-DD."));
    return;
  }
  const rangeDays = toDate.diff(fromDate, "days").days;
  if (rangeDays < 0 || rangeDays > 31) errors.push(invalid(`arguments.criteria.${criterion.stepKey}.toDate`, "Use uma janela de até 31 dias."));
  if (criterion.dateIntent === "exact_date" && rangeDays !== 0) errors.push(invalid(`arguments.criteria.${criterion.stepKey}.toDate`, "Para exact_date, use datas iguais."));
  if (criterion.dateIntent === "next_available" && rangeDays < 7) errors.push(invalid(`arguments.criteria.${criterion.stepKey}.toDate`, "Para next_available, use de 7 a 31 dias."));
  if (criterion.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(criterion.startTime)) {
    errors.push(invalid(`arguments.criteria.${criterion.stepKey}.startTime`, "Use HH:mm ou null."));
  }
}

async function validatePlanPrerequisites(
  customerId: ObjectId,
  plan: SchedulingPlan,
  configuration: AgentConfigurationDocument,
) {
  const [customer, payment] = await Promise.all([
    findCustomerById(customerId.toString()),
    getLatestPaymentRequest(customerId),
  ]);
  if (!customer) return validationError("calendar.find_plan_option", [invalid("customer", "Cliente não encontrado.")]);
  const profile = getCustomerProfileSnapshot(customer);
  const missingFields = getConfiguredMissingFields(profile, configuration.dataCollectionRules);
  const facts = {
    customer: { ...profile, missingFieldsCount: missingFields.length },
    operations: { paymentStatus: payment?.status ?? null },
  };
  return matchesConditions(facts, plan.prerequisites)
    ? null
    : validationError("calendar.find_plan_option", [invalid("prerequisites", "Os pré-requisitos configurados deste plano ainda não foram atendidos.")]);
}

async function validateBookingInput(action: CalendarToolArguments) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  const startAt = action.startAt
    ? DateTime.fromISO(action.startAt, { setZone: true })
    : null;

  validateEventType(action.eventType, settings, errors, "arguments.eventType");

  if (!action.confirmedByCustomer) {
    errors.push(invalid("arguments.confirmedByCustomer", "A reserva exige confirmação explícita do cliente."));
  }
  if (!startAt?.isValid || !startAt.isOffsetFixed) {
    errors.push(required("arguments.startAt", "Informe data, hora e offset, por exemplo 2026-09-02T09:00:00-03:00."));
  } else if (startAt.setZone(settings.timezone) <= DateTime.now().setZone(settings.timezone)) {
    errors.push(invalid("arguments.startAt", "O horário confirmado deve estar no futuro."));
  }

  return errors.length > 0 ? validationError("calendar.book_appointment", errors) : null;
}

async function validateListInput(action: CalendarToolArguments) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  const fromDate = parseDate(action.fromDate, settings.timezone);
  const toDate = parseDate(action.toDate, settings.timezone);
  if (!fromDate) errors.push(required("arguments.fromDate", "Informe a data inicial em YYYY-MM-DD."));
  if (!toDate) errors.push(required("arguments.toDate", "Informe a data final em YYYY-MM-DD."));
  if (fromDate && toDate && (toDate < fromDate || toDate.diff(fromDate, "days").days > 366)) {
    errors.push(invalid("arguments.toDate", "A consulta deve cobrir um período válido de até 366 dias."));
  }
  for (const eventType of action.eventTypes) {
    validateEventType(eventType, settings, errors, "arguments.eventTypes");
  }
  return errors.length > 0 ? validationError("calendar.list_appointments", errors) : null;
}

async function validateUpdateInput(action: CalendarToolArguments) {
  const settings = await getCalendarSettings();
  const errors: ToolValidationIssue[] = [];
  if (!action.appointmentId || !ObjectId.isValid(action.appointmentId)) {
    errors.push(required("arguments.appointmentId", "Informe um ID obtido pela consulta de eventos."));
  }
  if (!action.confirmedByCustomer) {
    errors.push(invalid("arguments.confirmedByCustomer", "A alteração exige confirmação explícita do cliente."));
  }
  if (!action.startAt && !action.eventType && action.notes === null) {
    errors.push(required("arguments", "Informe ao menos uma alteração de horário, tipo ou observação."));
  }
  if (action.eventType) validateEventType(action.eventType, settings, errors, "arguments.eventType");
  if (action.startAt) {
    const startAt = DateTime.fromISO(action.startAt, { setZone: true });
    if (!startAt.isValid || !startAt.isOffsetFixed) {
      errors.push(required("arguments.startAt", "Informe data, hora e offset no novo horário."));
    }
  }
  return errors.length > 0 ? validationError("calendar.update_appointment", errors) : null;
}

function validateEventType(
  eventType: string | null,
  settings: Awaited<ReturnType<typeof getCalendarSettings>>,
  errors: ToolValidationIssue[],
  field: string,
) {
  if (!eventType || !settings.eventTypes.some((item) => item.key === eventType)) {
    errors.push(required(field, "Informe uma chave de tipo de evento configurada."));
  }
}

interface ToolValidationIssue {
  field: string;
  code: "required" | "invalid" | "tool_call_required" | "flow_not_allowed" | "tool_not_allowed";
  message: string;
}

async function validationError(tool: string, errors: ToolValidationIssue[]): Promise<ToolExecution> {
  const settings = await getCalendarSettings();
  return {
    output: JSON.stringify({
      ok: false,
      type: "validation_error",
      tool,
      calendarNow: DateTime.now().setZone(settings.timezone).toISO(),
      timezone: settings.timezone,
      eventTypes: serializeEventTypes(settings.eventTypes),
      errors,
    }),
    retryable: true,
  };
}

function operationalError(tool: string, error: unknown, fallback: string): ToolExecution {
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

function serializeEventTypes(eventTypes: Awaited<ReturnType<typeof getCalendarSettings>>["eventTypes"]) {
  return eventTypes.map((eventType) => ({
    key: eventType.key,
    name: eventType.name,
    durationMinutes: eventType.durationMinutes,
  }));
}

export function executeRegisteredCalendarTool(
  action: CalendarToolArguments["action"],
  context: ToolExecutionContext,
  args: Record<string, unknown>,
) {
  return executeCalendarAction({
    ...context,
    action: {
      action,
      dateIntent: asValue(args.dateIntent, ["exact_date", "date_range", "next_available"]),
      fromDate: asString(args.fromDate),
      toDate: asString(args.toDate),
      period: asValue(args.period, ["morning", "afternoon", "any"]),
      appointmentId: asString(args.appointmentId),
      optionId: asString(args.optionId),
      eventType: asString(args.eventType),
      eventTypes: Array.isArray(args.eventTypes) ? args.eventTypes.filter((item): item is string => typeof item === "string") : [],
      startAt: asString(args.startAt),
      confirmedByCustomer: args.confirmedByCustomer === true,
      notes: asString(args.notes),
      planKey: asString(args.planKey),
      planPreference: asValue(args.preference, ["compact", "flexible"]),
      criteria: asPlanCriteria(args.criteria),
    },
  });
}

function asPlanCriteria(value: unknown): PlanToolCriteria[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const criterion = item as Record<string, unknown>;
    const stepKey = asString(criterion.stepKey);
    const parsed = asPlanSearchCriteria(criterion);
    return stepKey && parsed ? [{ stepKey, ...parsed }] : [];
  });
}

function asPlanSearchCriteria(value: unknown): PlanSearchCriteria | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const criteria = value as Record<string, unknown>;
  const dateIntent = asValue(criteria.dateIntent, ["exact_date", "date_range", "next_available"]);
  const fromDate = asString(criteria.fromDate);
  const toDate = asString(criteria.toDate);
  const period = asValue(criteria.period, ["morning", "afternoon", "any"]);
  const startTime = asString(criteria.startTime);
  return dateIntent && fromDate && toDate && period
    ? { dateIntent, fromDate, toDate, period, startTime }
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asValue<const Value extends string>(value: unknown, allowed: readonly Value[]) {
  return typeof value === "string" && allowed.includes(value as Value) ? value as Value : null;
}