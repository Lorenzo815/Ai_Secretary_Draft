import "server-only";

import { ObjectId } from "mongodb";
import { DateTime } from "luxon";
import { bookAppointment, findAvailableSlots, findCustomerAppointments, getCalendarSettings, updateCustomerAppointments } from "../../calendar";
import { bookSchedulingPlanOption, findSchedulingPlanOption, findSchedulingPlanOptions, getActiveSchedulingPlanOption, getSchedulingPlanOption, rescheduleSchedulingPlanOption, type SchedulingPlanOptionDocument, type SchedulingPreference } from "../../calendar/plans";
import { matchesConditions } from "../../automation/conditions";
import { findCustomerById, getCustomerProfileSnapshot } from "../../crm";
import { getLatestPaymentRequest } from "../../payments";
import type { AgentConfigurationDocument, SchedulingPlan } from "../agent/contracts";
import { getConfiguredMissingFields } from "../agent/runtime-context";
import type { ToolExecution, ToolExecutionContext } from "./contracts";

interface CalendarToolArguments {
  action: "find_slots" | "book" | "reschedule" | "find_plan_option" | "book_plan_option" | "list_appointments" | "check_availability" | "book_appointment" | "update_appointment";
  purpose: "book" | "reschedule" | null;
  dateIntent: "exact_date" | "date_range" | "next_available" | null;
  fromDate: string | null;
  toDate: string | null;
  horizonDays: number | null;
  period: "morning" | "afternoon" | "any" | null;
  preferredTime: string | null;
  ranking: Exclude<SchedulingPreference, "flexible"> | null;
  candidateCount: number | null;
  stepCriteria: PlanStepCriteria[];
  candidateId: string | null;
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
  appointmentUpdates: AppointmentToolUpdate[];
}

interface AppointmentToolUpdate {
  appointmentId: string | null;
  startAt: string | null;
  eventType: string | null;
  notes: string | null;
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

interface PlanStepCriteria {
  stepKey: string;
  dateIntent: "exact_date" | "date_range" | "next_available";
  fromDate: string;
  horizonDays: number;
  period: "morning" | "afternoon" | "any";
  startTime: string | null;
}

async function executeCalendarAction(input: {
  action: CalendarToolArguments;
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  activeSchedulingOptionId?: string;
  isMutationAllowed?: () => Promise<boolean>;
  configuration: AgentConfigurationDocument;
}): Promise<ToolExecution | null> {
  if (input.action.action === "find_slots") {
    const settings = await getCalendarSettings();
    const validation = validateFindSlotsInput(input.action, input.configuration, settings);
    if (validation.length > 0) return validationError("calendar.find_slots", validation);
    const plan = resolveSchedulingPlan(input.action, input.configuration, settings);
    if (!plan) return validationError("calendar.find_slots", [invalid("arguments", "Informe eventType ou planKey habilitado, mas não ambos.")]);
    if (!plan.key.startsWith("event:")) {
      const prerequisiteError = await validatePlanPrerequisites(input.customerId, plan, input.configuration, "calendar.find_slots");
      if (prerequisiteError) return prerequisiteError;
    }
    const targetAppointmentIds = input.action.purpose === "reschedule"
      ? await resolveRescheduleTargets(input.customerId, plan, settings.timezone)
      : [];
    if (input.action.purpose === "reschedule" && targetAppointmentIds.length === 0) {
      return validationError("calendar.find_slots", [invalid("currentAppointments", "Não foi possível identificar um único agendamento atual compatível. Encaminhe para a equipe.")]);
    }
    const appliedCriteria = plan.steps.map((step) => {
      const criterion = input.action.stepCriteria.find((item) => item.stepKey === step.key);
      const fromDate = criterion?.fromDate ?? input.action.fromDate!;
      const horizonDays = criterion?.horizonDays ?? input.action.horizonDays!;
      return {
        stepKey: step.key,
        dateIntent: criterion?.dateIntent ?? input.action.dateIntent!,
        fromDate,
        toDate: DateTime.fromISO(fromDate, { zone: settings.timezone }).plus({ days: horizonDays - 1 }).toISODate()!,
        period: criterion?.period ?? input.action.period!,
        startTime: criterion?.startTime ?? null,
      };
    });
    const globalToDate = DateTime.fromISO(input.action.fromDate!, { zone: settings.timezone })
      .plus({ days: input.action.horizonDays! - 1 }).toISODate()!;
    try {
      const result = await findSchedulingPlanOptions({
        customerId: input.customerId,
        plan,
        configRevision: input.configuration.revision,
        preference: input.action.ranking!,
        preferredTime: input.action.preferredTime,
        candidateCount: input.action.candidateCount!,
        purpose: input.action.purpose!,
        targetAppointmentIds,
        criteria: appliedCriteria,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.find_slots",
          purpose: input.action.purpose,
          timezone: result.settings.timezone,
          range: { fromDate: input.action.fromDate, toDate: globalToDate },
          appliedCriteria,
          configuredWindowsSource: "event_type_resource_weekly_availability",
          candidates: result.options.map((option) => serializeCandidate(option, plan)),
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError("calendar.find_slots", error, "Falha na consulta da agenda.");
    }
  }

  if (input.action.action === "book" || input.action.action === "reschedule") {
    const tool = `calendar.${input.action.action}`;
    if (!input.action.candidateId || !ObjectId.isValid(input.action.candidateId) || !input.action.confirmedByCustomer) {
      return validationError(tool, [invalid("arguments", "Informe candidateId válido e confirmação explícita do cliente.")]);
    }
    const option = await getSchedulingPlanOption(input.customerId, new ObjectId(input.action.candidateId));
    if (!option) return validationError(tool, [invalid("candidateId", "A proposta expirou ou foi substituída. Consulte novos horários.")]);
    const settings = await getCalendarSettings();
    const plan = resolveOptionPlan(option, input.configuration, settings);
    if (!plan) return validationError(tool, [invalid("candidateId", "A proposta usa uma configuração que não está mais ativa.")]);
    if (!plan.key.startsWith("event:")) {
      const prerequisiteError = await validatePlanPrerequisites(input.customerId, plan, input.configuration, tool);
      if (prerequisiteError) return prerequisiteError;
    }
    if (input.isMutationAllowed && !(await input.isMutationAllowed())) {
      return validationError(tool, [invalid("job", "Uma mensagem mais recente chegou antes da alteração. Nenhum agendamento foi modificado.")]);
    }
    try {
      if (input.action.action === "book") {
        const result = await bookSchedulingPlanOption({
          customerId: input.customerId,
          customerName: input.customerName,
          contactPhone: input.contactPhone,
          optionId: option._id,
          plan,
          configRevision: input.configuration.revision,
        });
        return {
          output: JSON.stringify({
            ok: true,
            tool,
            appointmentGroupId: result.appointmentGroupId.toString(),
            timezone: result.settings.timezone,
            steps: serializeCandidate(result.option, plan).steps,
          }),
          retryable: false,
        };
      }
      const result = await rescheduleSchedulingPlanOption({
        customerId: input.customerId,
        optionId: option._id,
        plan,
        configRevision: input.configuration.revision,
      });
      return {
        output: JSON.stringify({
          ok: true,
          tool,
          timezone: result.settings.timezone,
          steps: serializeCandidate(result.option, plan).steps,
        }),
        retryable: false,
      };
    } catch (error) {
      return operationalError(tool, error, input.action.action === "book" ? "Falha na reserva." : "Falha no reagendamento.");
    }
  }

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
      const appointments = await updateCustomerAppointments({
        customerId: input.customerId,
        appointments: input.action.appointmentUpdates.map((appointment) => ({
          appointmentId: new ObjectId(appointment.appointmentId!),
          startAt: appointment.startAt ?? undefined,
          eventType: appointment.eventType ?? undefined,
          notes: appointment.notes ?? undefined,
        })),
      });
      const settings = await getCalendarSettings();
      return {
        output: JSON.stringify({
          ok: true,
          tool: "calendar.update_appointment",
          appointments: appointments.map((appointment) => ({
            appointmentId: appointment._id.toString(),
            startAt: appointment.startAt.toISOString(),
            endAt: appointment.endAt.toISOString(),
            eventType: appointment.eventType,
            eventTypeName: settings.eventTypes.find((item) => item.key === appointment.eventType)?.name ?? "Tipo removido",
          })),
          eventTypes: serializeEventTypes(settings.eventTypes),
          timezone: settings.timezone,
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

function validateFindSlotsInput(
  action: CalendarToolArguments,
  configuration: AgentConfigurationDocument,
  settings: Awaited<ReturnType<typeof getCalendarSettings>>,
) {
  const errors: ToolValidationIssue[] = [];
  const hasEventType = Boolean(action.eventType);
  const hasPlan = Boolean(action.planKey);
  if (hasEventType === hasPlan) errors.push(invalid("arguments", "Informe eventType ou planKey, mas não ambos."));
  if (hasEventType) validateEventType(action.eventType, settings, errors, "arguments.eventType");
  if (hasPlan && !configuration.schedulingPlans.some((plan) => plan.enabled && plan.key === action.planKey)) {
    errors.push(invalid("arguments.planKey", "Informe a chave de um plano habilitado."));
  }
  if (!action.purpose) errors.push(required("arguments.purpose", "Informe book ou reschedule."));
  if (!action.dateIntent) errors.push(required("arguments.dateIntent", "Informe como a data foi interpretada."));
  if (!parseDate(action.fromDate, settings.timezone)) errors.push(required("arguments.fromDate", "Informe a data inicial local em YYYY-MM-DD."));
  if (!Number.isInteger(action.horizonDays) || action.horizonDays! < 1 || action.horizonDays! > 60) {
    errors.push(invalid("arguments.horizonDays", "Use um horizonte entre 1 e 60 dias."));
  } else if (action.dateIntent === "exact_date" && action.horizonDays !== 1) {
    errors.push(invalid("arguments.horizonDays", "Para exact_date, use horizonDays=1."));
  }
  if (!action.period) errors.push(required("arguments.period", "Informe morning, afternoon ou any."));
  if (!action.ranking) errors.push(required("arguments.ranking", "Informe a preferência de ordenação."));
  if (!Number.isInteger(action.candidateCount) || action.candidateCount! < 1 || action.candidateCount! > 5) {
    errors.push(invalid("arguments.candidateCount", "Solicite de uma a cinco opções."));
  }
  if (action.preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.preferredTime)) {
    errors.push(invalid("arguments.preferredTime", "Use HH:mm ou null."));
  }
  if (action.ranking === "closest_to_time" && !action.preferredTime) {
    errors.push(required("arguments.preferredTime", "closest_to_time exige o horário preferido do cliente."));
  }
  const plan = action.planKey
    ? configuration.schedulingPlans.find((item) => item.enabled && item.key === action.planKey)
    : null;
  if (action.stepCriteria.length > 0 && !plan) {
    errors.push(invalid("arguments.stepCriteria", "Use critérios por etapa somente com um planKey habilitado."));
  } else if (plan) {
    const stepKeys = new Set(action.stepCriteria.map((criterion) => criterion.stepKey));
    if (stepKeys.size !== action.stepCriteria.length || action.stepCriteria.some((criterion) => !plan.steps.some((step) => step.key === criterion.stepKey))) {
      errors.push(invalid("arguments.stepCriteria", "Use cada stepKey configurado no plano no máximo uma vez."));
    }
    for (const criterion of action.stepCriteria) validateStepCriterion(criterion, settings.timezone, errors);
  }
  return errors;
}

function validateStepCriterion(criterion: PlanStepCriteria, timezone: string, errors: ToolValidationIssue[]) {
  if (!parseDate(criterion.fromDate, timezone)) {
    errors.push(invalid(`arguments.stepCriteria.${criterion.stepKey}.fromDate`, "Use uma data local válida em YYYY-MM-DD."));
  }
  if (!Number.isInteger(criterion.horizonDays) || criterion.horizonDays < 1 || criterion.horizonDays > 60) {
    errors.push(invalid(`arguments.stepCriteria.${criterion.stepKey}.horizonDays`, "Use um horizonte entre 1 e 60 dias."));
  } else if (criterion.dateIntent === "exact_date" && criterion.horizonDays !== 1) {
    errors.push(invalid(`arguments.stepCriteria.${criterion.stepKey}.horizonDays`, "Para exact_date, use horizonDays=1."));
  }
  if (criterion.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(criterion.startTime)) {
    errors.push(invalid(`arguments.stepCriteria.${criterion.stepKey}.startTime`, "Use HH:mm ou null."));
  }
}

function resolveSchedulingPlan(
  action: CalendarToolArguments,
  configuration: AgentConfigurationDocument,
  settings: Awaited<ReturnType<typeof getCalendarSettings>>,
) {
  if (action.planKey) return configuration.schedulingPlans.find((plan) => plan.enabled && plan.key === action.planKey) ?? null;
  const eventType = settings.eventTypes.find((item) => item.key === action.eventType);
  return eventType ? singleEventPlan(eventType.key, eventType.name) : null;
}

function resolveOptionPlan(
  option: SchedulingPlanOptionDocument,
  configuration: AgentConfigurationDocument,
  settings: Awaited<ReturnType<typeof getCalendarSettings>>,
) {
  if (!option.planKey.startsWith("event:")) {
    return configuration.schedulingPlans.find((plan) => plan.enabled && plan.key === option.planKey) ?? null;
  }
  const eventType = settings.eventTypes.find((item) => `event:${item.key}` === option.planKey);
  return eventType ? singleEventPlan(eventType.key, eventType.name) : null;
}

function singleEventPlan(eventType: string, name: string): SchedulingPlan {
  return {
    key: `event:${eventType}`,
    name,
    description: "Agendamento de evento único.",
    enabled: true,
    steps: [{ key: "appointment", eventTypeKey: eventType, label: name, required: true }],
    constraints: [],
    prerequisites: {},
    proposalExpiryMinutes: 30,
  };
}

async function resolveRescheduleTargets(customerId: ObjectId, plan: SchedulingPlan, timezone: string) {
  const now = DateTime.now().setZone(timezone);
  const result = await findCustomerAppointments({
    customerId,
    fromDate: now.toISODate()!,
    toDate: now.plus({ days: 365 }).toISODate()!,
    eventTypes: [...new Set(plan.steps.map((step) => step.eventTypeKey))],
    limit: 50,
  });
  const groups = new Map<string, typeof result.appointments>();
  for (const appointment of result.appointments) {
    const key = appointment.visitGroupId?.toHexString() ?? appointment._id.toHexString();
    groups.set(key, [...(groups.get(key) ?? []), appointment]);
  }
  const matchingGroups = [...groups.values()].flatMap((appointments) => {
    const remaining = [...appointments];
    const ids = plan.steps.flatMap((step) => {
      const index = remaining.findIndex((appointment) => appointment.eventType === step.eventTypeKey);
      if (index < 0) return [];
      return [remaining.splice(index, 1)[0]._id];
    });
    return ids.length === plan.steps.length ? [ids] : [];
  });
  return matchingGroups.length === 1 ? matchingGroups[0] : [];
}

function serializeCandidate(option: SchedulingPlanOptionDocument, plan: SchedulingPlan) {
  return {
    candidateId: option._id.toHexString(),
    planKey: plan.key.startsWith("event:") ? null : plan.key,
    planName: plan.name,
    expiresAt: option.expiresAt.toISOString(),
    steps: option.steps.map((step) => {
      const local = DateTime.fromISO(step.slot.startAt, { setZone: true });
      return {
        stepKey: step.stepKey,
        eventType: step.eventTypeKey,
        label: plan.steps.find((definition) => definition.key === step.stepKey)?.label ?? step.stepKey,
        startAt: step.slot.startAt,
        endAt: step.slot.endAt,
        localDate: local.toISODate(),
        localTime: local.toFormat("HH:mm"),
        weekday: local.weekday,
        weekdayLabel: local.setLocale("pt-BR").toFormat("cccc"),
        timezone: local.zoneName,
      };
    }),
  };
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
  tool = "calendar.find_plan_option",
) {
  const [customer, payment] = await Promise.all([
    findCustomerById(customerId.toString()),
    getLatestPaymentRequest(customerId),
  ]);
  if (!customer) return validationError(tool, [invalid("customer", "Cliente não encontrado.")]);
  const profile = getCustomerProfileSnapshot(customer);
  const missingFields = getConfiguredMissingFields(profile, configuration.dataCollectionRules);
  const facts = {
    customer: { ...profile, missingFieldsCount: missingFields.length },
    operations: { paymentStatus: payment?.status ?? null },
  };
  return matchesConditions(facts, plan.prerequisites)
    ? null
    : validationError(tool, [invalid("prerequisites", "Os pré-requisitos configurados deste plano ainda não foram atendidos.")]);
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
  if (!action.confirmedByCustomer) {
    errors.push(invalid("arguments.confirmedByCustomer", "A alteração exige confirmação explícita do cliente."));
  }
  if (action.appointmentUpdates.length === 0 || action.appointmentUpdates.length > 10) {
    errors.push(required("arguments.appointments", "Informe de um a dez eventos obtidos pela consulta de eventos."));
  }
  const appointmentIds = new Set<string>();
  for (const [index, appointment] of action.appointmentUpdates.entries()) {
    const field = `arguments.appointments.${index}`;
    if (!appointment.appointmentId || !ObjectId.isValid(appointment.appointmentId)) {
      errors.push(required(`${field}.appointmentId`, "Informe um ID obtido pela consulta de eventos no job atual."));
    } else if (appointmentIds.has(appointment.appointmentId)) {
      errors.push(invalid(`${field}.appointmentId`, "Cada evento deve aparecer uma única vez."));
    } else {
      appointmentIds.add(appointment.appointmentId);
    }
    if (!appointment.startAt && !appointment.eventType && appointment.notes === null) {
      errors.push(required(field, "Informe ao menos uma alteração de horário, tipo ou observação."));
    }
    if (appointment.eventType) validateEventType(appointment.eventType, settings, errors, `${field}.eventType`);
    if (appointment.startAt) {
      const startAt = DateTime.fromISO(appointment.startAt, { setZone: true });
      if (!startAt.isValid || !startAt.isOffsetFixed) {
        errors.push(required(`${field}.startAt`, "Informe data, hora e offset no novo horário."));
      }
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
      purpose: asValue(args.purpose, ["book", "reschedule"]),
      dateIntent: asValue(args.dateIntent, ["exact_date", "date_range", "next_available"]),
      fromDate: asString(args.fromDate),
      toDate: asString(args.toDate),
      horizonDays: asInteger(args.horizonDays),
      period: asValue(args.period, ["morning", "afternoon", "any"]),
      preferredTime: asString(args.preferredTime),
      ranking: asValue(args.ranking, ["earliest", "latest", "compact", "closest_to_time", "fill_gap"]),
      candidateCount: asInteger(args.candidateCount),
      stepCriteria: asStepCriteria(args.stepCriteria),
      candidateId: asString(args.candidateId),
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
      appointmentUpdates: asAppointmentUpdates(args.appointments),
    },
  });
}

function asStepCriteria(value: unknown): PlanStepCriteria[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const criterion = item as Record<string, unknown>;
    const stepKey = asString(criterion.stepKey);
    const dateIntent = asValue(criterion.dateIntent, ["exact_date", "date_range", "next_available"]);
    const fromDate = asString(criterion.fromDate);
    const horizonDays = asInteger(criterion.horizonDays);
    const period = asValue(criterion.period, ["morning", "afternoon", "any"]);
    if (!stepKey || !dateIntent || !fromDate || horizonDays === null || !period) return [];
    return [{ stepKey, dateIntent, fromDate, horizonDays, period, startTime: asString(criterion.startTime) }];
  });
}

function asAppointmentUpdates(value: unknown): AppointmentToolUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const appointment = item as Record<string, unknown>;
    return [{
      appointmentId: asString(appointment.appointmentId),
      startAt: asString(appointment.startAt),
      eventType: asString(appointment.eventType),
      notes: asString(appointment.notes),
    }];
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

function asInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asValue<const Value extends string>(value: unknown, allowed: readonly Value[]) {
  return typeof value === "string" && allowed.includes(value as Value) ? value as Value : null;
}