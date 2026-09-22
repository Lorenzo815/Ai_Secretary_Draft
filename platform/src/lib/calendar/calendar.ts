import "server-only";

import { Collection, MongoServerError, ObjectId, type UpdateFilter } from "mongodb";
import { DateTime, Interval } from "luxon";
import clientPromise from "../mongodb";
import { scheduleFirstAppointmentQualification } from "../qualification/triggers";
import { getSlotAccessDecision, isSlotAllowedByAccessEvents } from "./access-policy";

export interface WeeklyAvailability {
  weekday: number;
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

export interface CalendarEventTypeDefinition {
  key: string;
  name: string;
  color: string;
  durationMinutes: number;
  resourceId: string;
}

export interface CalendarResourceDefinition {
  id: string;
  name: string;
  weeklyAvailability: WeeklyAvailability[];
}

export interface CalendarSettingsDocument {
  _id: string;
  providerId: string;
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  weeklyAvailability: WeeklyAvailability[];
  resources: CalendarResourceDefinition[];
  eventTypes: CalendarEventTypeDefinition[];
  updatedAt: Date;
}

export interface AppointmentDocument {
  _id: ObjectId;
  providerId: string;
  customerId?: ObjectId;
  customerName: string;
  contactPhone: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  status: "held" | "scheduled" | "cancelled" | "completed";
  holdExpiresAt?: Date;
  schedulingOptionId?: ObjectId;
  eventType: string;
  visitGroupId?: ObjectId;
  notes?: string;
  source: "assistant" | "manual";
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarAccessEventDocument {
  _id: ObjectId;
  type: "permission" | "blocker";
  title: string;
  startAt: Date;
  endAt: Date;
  resourceIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AvailableSlot {
  startAt: string;
  endAt: string;
  localDate: string;
  localTime: string;
  weekday: number;
  weekdayLabel: string;
  timezone: string;
  gapWasteMinutes: number;
  label: string;
}

interface PersistAppointmentInput {
  customerId?: ObjectId;
  customerName: string;
  contactPhone: string;
  startAt: string;
  notes?: string;
  source: "assistant" | "manual";
  eventType?: string;
  visitGroupId?: ObjectId;
  status?: "held" | "scheduled";
  holdExpiresAt?: Date;
  schedulingOptionId?: ObjectId;
}

interface BookAppointmentInput extends PersistAppointmentInput {
  customerId: ObjectId;
  deferQualificationTrigger?: boolean;
}

const DB_NAME = "ai_secretary";
export const DEFAULT_PROVIDER_ID = "default-doctor";
const SETTINGS_ID = "default-calendar";
const DEFAULT_SLOT_DURATION_MINUTES = 30;
const validSlotDurations = new Set([15, 20, 30, 45, 60, 90, 120]);

const defaultWeek: WeeklyAvailability[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    enabled: true,
    intervals: [{ startTime: "09:00", endTime: "12:00" }, { startTime: "13:00", endTime: "17:00" }],
  })),
  { weekday: 6, enabled: false, intervals: [{ startTime: "09:00", endTime: "13:00" }] },
  { weekday: 7, enabled: false, intervals: [{ startTime: "09:00", endTime: "13:00" }] },
];
const defaultEventTypes: CalendarEventTypeDefinition[] = [
  { key: "doctor_consultation", name: "Consulta Dr.", color: "#0F766E", durationMinutes: 90, resourceId: "doctor" },
  { key: "bioimpedance", name: "Bioimpedância", color: "#C2410C", durationMinutes: 30, resourceId: "technician" },
  { key: "consultation", name: "Consulta", color: "#0F766E", durationMinutes: 30, resourceId: "doctor" },
  { key: "follow_up", name: "Retorno", color: "#2563EB", durationMinutes: 30, resourceId: "doctor" },
  { key: "evaluation", name: "Avaliação", color: "#7C3AED", durationMinutes: 60, resourceId: "doctor" },
  { key: "blocked", name: "Bloqueio de agenda", color: "#78716C", durationMinutes: 30, resourceId: "doctor" },
];
const defaultResources: CalendarResourceDefinition[] = [
  { id: "doctor", name: "Dr. Matheus", weeklyAvailability: defaultWeek },
  { id: "technician", name: "Técnica de Bioimpedância", weeklyAvailability: defaultWeek },
];

async function getSettingsCollection(): Promise<Collection<CalendarSettingsDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CalendarSettingsDocument>("calendar_settings");
}

async function getAppointmentsCollection(): Promise<Collection<AppointmentDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AppointmentDocument>("calendar_appointments");
}

async function getAccessEventsCollection(): Promise<Collection<CalendarAccessEventDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CalendarAccessEventDocument>("calendar_access_events");
}

export async function getCalendarSettings() {
  const settings = await getSettingsCollection();
  const existing = await settings.findOne({ _id: SETTINGS_ID });
  if (existing) {
    const slotDurationMinutes = normalizeSlotDuration(existing.slotDurationMinutes);
    const weeklyAvailability = normalizeWeeklyAvailability(existing.weeklyAvailability);
    const resources = normalizeResources(existing.resources, weeklyAvailability);
    const eventTypes = normalizeEventTypes(existing.eventTypes, slotDurationMinutes);
    if (slotDurationMinutes !== existing.slotDurationMinutes || JSON.stringify(weeklyAvailability) !== JSON.stringify(existing.weeklyAvailability) || JSON.stringify(resources) !== JSON.stringify(existing.resources) || JSON.stringify(eventTypes) !== JSON.stringify(existing.eventTypes)) {
      await settings.updateOne(
        { _id: SETTINGS_ID },
        { $set: { slotDurationMinutes, weeklyAvailability, resources, eventTypes, updatedAt: new Date() }, $unset: { followUpHoursBefore: "" } },
      );
    }
    const normalized = { ...existing, slotDurationMinutes, weeklyAvailability, resources, eventTypes };
    delete (normalized as typeof normalized & { followUpHoursBefore?: number }).followUpHoursBefore;
    return normalized;
  }
  const initial: CalendarSettingsDocument = {
    _id: SETTINGS_ID,
    providerId: DEFAULT_PROVIDER_ID,
    providerName: "Dr(a). responsável",
    timezone: "America/Sao_Paulo",
    slotDurationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
    minimumNoticeHours: 2,
    weeklyAvailability: defaultWeek,
    resources: defaultResources,
    eventTypes: defaultEventTypes,
    updatedAt: new Date(),
  };
  await settings.insertOne(initial);
  return initial;
}

export async function updateCalendarSettings(input: {
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  weeklyAvailability: WeeklyAvailability[];
  resources: CalendarResourceDefinition[];
  eventTypes: CalendarEventTypeDefinition[];
}) {
  validateSettings(input);
  const current = await getCalendarSettings();
  const nextResourceIds = new Set(input.resources.map((resource) => resource.id));
  const removedResourceIds = current.resources
    .map((resource) => resource.id)
    .filter((resourceId) => !nextResourceIds.has(resourceId));
  if (removedResourceIds.length > 0) {
    const futureAppointment = await (await getAppointmentsCollection()).findOne({
      providerId: { $in: removedResourceIds },
      status: { $in: ["held", "scheduled"] },
      endAt: { $gt: new Date() },
    });
    if (futureAppointment) {
      throw new Error("Não é possível remover um profissional com atendimentos futuros.");
    }
  }
  const next: CalendarSettingsDocument = {
    ...current,
    providerName: input.providerName.trim().slice(0, 100),
    timezone: input.timezone,
    slotDurationMinutes: input.slotDurationMinutes,
    minimumNoticeHours: input.minimumNoticeHours,
    weeklyAvailability: input.weeklyAvailability,
    resources: input.resources.map((resource) => ({
      id: resource.id.trim(),
      name: resource.name.trim().slice(0, 100),
      weeklyAvailability: resource.weeklyAvailability,
    })),
    eventTypes: input.eventTypes.map((eventType) => ({
      key: eventType.key.trim(),
      name: eventType.name.trim().slice(0, 60),
      color: eventType.color.toUpperCase(),
      durationMinutes: eventType.durationMinutes,
      resourceId: eventType.resourceId.trim(),
    })),
    updatedAt: new Date(),
  };
  await (await getSettingsCollection()).replaceOne({ _id: SETTINGS_ID }, next, { upsert: true });
  return next;
}

export async function listAppointments(from: Date, to: Date) {
  const now = new Date();
  return (await getAppointmentsCollection())
    .find({
      startAt: { $gte: from, $lt: to },
      $or: [
        { status: { $ne: "held" } },
        { status: "held", holdExpiresAt: { $gt: now } },
      ],
    })
    .sort({ startAt: 1 })
    .toArray();
}

export async function listCalendarAccessEvents(from?: Date, to?: Date) {
  const filter = from && to
    ? { startAt: { $lt: to }, endAt: { $gt: from } }
    : {};
  return (await getAccessEventsCollection())
    .find(filter)
    .sort({ startAt: 1 })
    .toArray();
}

export async function createCalendarAccessEvent(input: {
  type: "permission" | "blocker";
  title: string;
  startAt: string;
  endAt: string;
  resourceIds: string[];
}) {
  const settings = await getCalendarSettings();
  if (input.type !== "permission" && input.type !== "blocker") {
    throw new Error("Tipo de regra de agenda inválido.");
  }
  const startAt = DateTime.fromISO(input.startAt, { zone: settings.timezone, setZone: true });
  const endAt = DateTime.fromISO(input.endAt, { zone: settings.timezone, setZone: true });
  if (!startAt.isValid || !endAt.isValid || endAt <= startAt) {
    throw new Error("Informe um intervalo válido com término posterior ao início.");
  }
  const validResourceIds = new Set(settings.resources.map((resource) => resource.id));
  const resourceIds = [...new Set(input.resourceIds)];
  if (resourceIds.some((resourceId) => !validResourceIds.has(resourceId))) {
    throw new Error("A regra aponta para um profissional inexistente.");
  }
  if (input.type === "blocker") {
    const conflict = await (await getAppointmentsCollection()).findOne({
      status: "scheduled",
      ...(resourceIds.length > 0 ? { providerId: { $in: resourceIds } } : {}),
      startAt: { $lt: endAt.toUTC().toJSDate() },
      endAt: { $gt: startAt.toUTC().toJSDate() },
    });
    if (conflict) {
      throw new Error("Este bloqueio conflita com um agendamento existente. Reagende ou cancele o evento antes de bloquear.");
    }
  }
  const now = new Date();
  const event: CalendarAccessEventDocument = {
    _id: new ObjectId(),
    type: input.type,
    title: input.title.trim().slice(0, 120) || (input.type === "permission" ? "Atendimento permitido" : "Agenda bloqueada"),
    startAt: startAt.toUTC().toJSDate(),
    endAt: endAt.toUTC().toJSDate(),
    resourceIds,
    createdAt: now,
    updatedAt: now,
  };
  await ensureCalendarIndexes();
  await (await getAccessEventsCollection()).insertOne(event);
  return event;
}

export async function deleteCalendarAccessEvent(id: string) {
  if (!ObjectId.isValid(id)) throw new Error("Regra de agenda inválida.");
  const result = await (await getAccessEventsCollection()).findOneAndDelete({ _id: new ObjectId(id) });
  if (!result) throw new Error("Regra de agenda não encontrada.");
  return result;
}

export async function hasFutureScheduledAppointment(customerId: ObjectId, now = new Date()) {
  return Boolean(await (await getAppointmentsCollection()).findOne({
    customerId,
    status: "scheduled",
    startAt: { $gte: now },
  }, { projection: { _id: 1 } }));
}

export async function findCustomerAppointments(input: {
  customerId: ObjectId;
  fromDate: string;
  toDate: string;
  eventTypes?: string[];
  limit?: number;
}) {
  const settings = await getCalendarSettings();
  const from = DateTime.fromISO(input.fromDate, { zone: settings.timezone }).startOf("day");
  const to = DateTime.fromISO(input.toDate, { zone: settings.timezone }).endOf("day");
  if (!from.isValid || !to.isValid || to < from || to.diff(from, "days").days > 366) {
    throw new Error("Período de consulta inválido.");
  }
  const validTypes = new Set(settings.eventTypes.map((eventType) => eventType.key));
  const eventTypes = [...new Set(input.eventTypes ?? [])];
  if (eventTypes.some((eventType) => !validTypes.has(eventType))) {
    throw new Error("Tipo de evento inválido.");
  }
  const appointments = await (await getAppointmentsCollection())
    .find({
      customerId: input.customerId,
      status: "scheduled",
      startAt: { $gte: from.toUTC().toJSDate(), $lte: to.toUTC().toJSDate() },
      ...(eventTypes.length > 0 ? { eventType: { $in: eventTypes } } : {}),
    })
    .sort({ startAt: 1 })
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 50))
    .toArray();
  return { settings, appointments };
}

export async function findAvailableSlots(input: {
  fromDate: string;
  toDate: string;
  eventType?: string;
  period?: "morning" | "afternoon" | "any";
  startTime?: string | null;
  limit?: number;
  excludeAppointmentId?: ObjectId;
  excludeAppointmentIds?: ObjectId[];
}) {
  await releaseExpiredAppointmentHolds();
  const settings = await getCalendarSettings();
  const startDay = DateTime.fromISO(input.fromDate, { zone: settings.timezone }).startOf("day");
  const endDay = DateTime.fromISO(input.toDate, { zone: settings.timezone }).endOf("day");
  if (!startDay.isValid || !endDay.isValid || endDay < startDay) {
    throw new Error("Período de busca inválido.");
  }
  if (endDay.diff(startDay, "days").days > 60) {
    throw new Error("A busca de disponibilidade deve cobrir no máximo 60 dias.");
  }

  const eventType = settings.eventTypes.find((item) => item.key === input.eventType) ?? settings.eventTypes[0];
  const [appointments, accessEvents] = await Promise.all([
    listAppointments(startDay.toUTC().toJSDate(), endDay.toUTC().toJSDate()),
    listCalendarAccessEvents(startDay.toUTC().toJSDate(), endDay.toUTC().toJSDate()),
  ]);
  const excludedAppointmentIds = input.excludeAppointmentIds ?? (input.excludeAppointmentId ? [input.excludeAppointmentId] : []);
  const occupied = appointments
    .filter((appointment) => (
      (
        appointment.status === "scheduled" ||
        (appointment.status === "held" && appointment.holdExpiresAt && appointment.holdExpiresAt > new Date())
      ) &&
      appointment.providerId === eventType.resourceId &&
      !excludedAppointmentIds.some((appointmentId) => appointment._id.equals(appointmentId))
    ))
    .map((appointment) => Interval.fromDateTimes(
      DateTime.fromJSDate(appointment.startAt),
      DateTime.fromJSDate(appointment.endAt),
    ));
  const earliest = DateTime.now().setZone(settings.timezone).plus({ hours: settings.minimumNoticeHours });
  const durationMinutes = eventType.durationMinutes;
  const slotDurationMinutes = normalizeSlotDuration(settings.slotDurationMinutes);
  const slots: AvailableSlot[] = [];
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);

  for (let day = startDay; day <= endDay && slots.length < limit; day = day.plus({ days: 1 })) {
    const resource = settings.resources.find((item) => item.id === eventType.resourceId);
    const availability = (resource?.weeklyAvailability ?? settings.weeklyAvailability)
      .find((item) => item.weekday === day.weekday);
    if (!availability?.enabled) continue;
    for (const interval of availability.intervals) {
      let cursor = atLocalTime(day, interval.startTime);
      const intervalEnd = atLocalTime(day, interval.endTime);
      while (cursor.plus({ minutes: durationMinutes }) <= intervalEnd && slots.length < limit) {
        const slotEnd = cursor.plus({ minutes: durationMinutes });
        const slotInterval = Interval.fromDateTimes(cursor.toUTC(), slotEnd.toUTC());
        const periodMatches = input.period === "morning"
          ? cursor.hour < 12
          : input.period === "afternoon"
            ? cursor.hour >= 12
            : true;
        const timeMatches = !input.startTime || cursor.toFormat("HH:mm") === input.startTime;
        const accessAllowed = isSlotAllowedByAccessEvents(
          accessEvents,
          eventType.resourceId,
          slotInterval.start!.toJSDate(),
          slotInterval.end!.toJSDate(),
        );
        if (cursor >= earliest && periodMatches && timeMatches && accessAllowed && !occupied.some((item) => item.overlaps(slotInterval))) {
          const previousBoundary = occupied
            .filter((item) => item.end && item.end <= cursor.toUTC())
            .reduce((latest, item) => item.end! > latest ? item.end! : latest, cursor.startOf("day").toUTC());
          const nextBoundary = occupied
            .filter((item) => item.start && item.start >= slotEnd.toUTC())
            .reduce((earliestBoundary, item) => item.start! < earliestBoundary ? item.start! : earliestBoundary, cursor.endOf("day").toUTC());
          const openStart = DateTime.max(atLocalTime(day, interval.startTime).toUTC(), previousBoundary);
          const openEnd = DateTime.min(intervalEnd.toUTC(), nextBoundary);
          slots.push({
            startAt: cursor.toISO()!,
            endAt: slotEnd.toISO()!,
            localDate: cursor.toISODate()!,
            localTime: cursor.toFormat("HH:mm"),
            weekday: cursor.weekday,
            weekdayLabel: cursor.setLocale("pt-BR").toFormat("cccc"),
            timezone: settings.timezone,
            gapWasteMinutes: Math.max(0, openEnd.diff(openStart, "minutes").minutes - durationMinutes),
            label: cursor.setLocale("pt-BR").toFormat("ccc, dd/LL 'às' HH:mm"),
          });
        }
        cursor = cursor.plus({ minutes: slotDurationMinutes });
      }
    }
  }
  return { settings, slots };
}

export async function bookAppointment(input: BookAppointmentInput) {
  const settings = await getCalendarSettings();
  const requested = DateTime.fromISO(input.startAt, { setZone: true }).setZone(settings.timezone);
  if (!requested.isValid) throw new Error("Data do agendamento inválida.");
  const date = requested.toISODate();
  const available = await findAvailableSlots({ fromDate: date!, toDate: date!, eventType: input.eventType, limit: 50 });
  const slot = available.slots.find((item) => DateTime.fromISO(item.startAt).toUTC().toMillis() === requested.toUTC().toMillis());
  if (!slot) throw new Error("O horário escolhido não está mais disponível.");

  const appointment = await persistAppointment(
    input,
    settings,
    DateTime.fromISO(slot.startAt).toUTC(),
    DateTime.fromISO(slot.endAt).toUTC(),
  );
  if (!input.deferQualificationTrigger) {
    await scheduleFirstAppointmentQualification(input.customerId, appointment._id, appointment.createdAt);
  }
  return appointment;
}

export async function holdAppointment(input: BookAppointmentInput & {
  holdExpiresAt: Date;
  schedulingOptionId: ObjectId;
}) {
  const settings = await getCalendarSettings();
  const requested = DateTime.fromISO(input.startAt, { setZone: true }).setZone(settings.timezone);
  if (!requested.isValid) throw new Error("Data da reserva temporária inválida.");
  if (input.holdExpiresAt <= new Date()) throw new Error("O prazo da reserva temporária já expirou.");
  const date = requested.toISODate();
  const available = await findAvailableSlots({ fromDate: date!, toDate: date!, eventType: input.eventType, limit: 50 });
  const slot = available.slots.find((item) => DateTime.fromISO(item.startAt).toUTC().toMillis() === requested.toUTC().toMillis());
  if (!slot) throw new Error("O horário escolhido não está mais disponível.");

  return persistAppointment(
    {
      ...input,
      status: "held",
      notes: input.notes ?? "Reserva temporária aguardando confirmação do sinal.",
    },
    settings,
    DateTime.fromISO(slot.startAt).toUTC(),
    DateTime.fromISO(slot.endAt).toUTC(),
  );
}

export async function confirmAppointmentHolds(customerId: ObjectId) {
  const appointments = await getAppointmentsCollection();
  await releaseExpiredAppointmentHolds();
  const now = new Date();
  const held = await appointments.find({
    customerId,
    status: "held",
    holdExpiresAt: { $gt: now },
  }).sort({ startAt: 1 }).toArray();
  if (held.length === 0) return [];
  const result = await appointments.updateMany(
    {
      _id: { $in: held.map((appointment) => appointment._id) },
      customerId,
      status: "held",
      holdExpiresAt: { $gt: now },
    },
    {
      $set: { status: "scheduled", updatedAt: now },
      $unset: { holdExpiresAt: "", schedulingOptionId: "" },
    },
  );
  if (result.modifiedCount !== held.length) {
    throw new Error("Uma reserva temporária expirou durante a confirmação do sinal.");
  }
  await scheduleFirstAppointmentQualification(
    customerId,
    held.map((appointment) => appointment._id),
  );
  return held.map((appointment) => ({
    ...appointment,
    status: "scheduled" as const,
    updatedAt: now,
    holdExpiresAt: undefined,
    schedulingOptionId: undefined,
  }));
}

export async function releaseAppointmentHolds(customerId: ObjectId, preserveVisitGroupId?: ObjectId) {
  const now = new Date();
  const result = await (await getAppointmentsCollection()).updateMany(
    {
      customerId,
      status: "held",
      ...(preserveVisitGroupId ? { visitGroupId: { $ne: preserveVisitGroupId } } : {}),
    },
    {
      $set: { status: "cancelled", updatedAt: now },
      $unset: { holdExpiresAt: "", schedulingOptionId: "" },
    },
  );
  return result.modifiedCount;
}

async function releaseExpiredAppointmentHolds(now = new Date()) {
  await (await getAppointmentsCollection()).deleteMany({
    status: "held",
    holdExpiresAt: { $lte: now },
  });
}

export async function bookManualAppointment(input: PersistAppointmentInput) {
  const settings = await getCalendarSettings();
  const slot = await validateManualAppointmentSlot({
    settings,
    startAt: input.startAt,
    eventTypeKey: input.eventType,
  });

  const appointment = await persistAppointment(
    input,
    settings,
    slot.startAt,
    slot.endAt,
  );
  if (input.customerId) {
    await scheduleFirstAppointmentQualification(input.customerId, appointment._id, appointment.createdAt);
  }
  return appointment;
}

export async function updateManualAppointment(input: {
  appointmentId: string;
  customerId?: ObjectId;
  customerName: string;
  contactPhone: string;
  startAt: string;
  eventType: string;
  notes?: string;
}) {
  if (!ObjectId.isValid(input.appointmentId)) throw new Error("Evento inválido.");
  const appointments = await getAppointmentsCollection();
  const appointmentId = new ObjectId(input.appointmentId);
  const current = await appointments.findOne({
    _id: appointmentId,
    source: "manual",
    status: "scheduled",
  });
  if (!current) throw new Error("Evento manual não encontrado ou já encerrado.");

  const settings = await getCalendarSettings();
  const slot = await validateManualAppointmentSlot({
    settings,
    startAt: input.startAt,
    eventTypeKey: input.eventType,
    excludeAppointmentId: appointmentId,
  });
  const now = new Date();
  const notes = input.notes?.trim().slice(0, 1_000);
  const setFields = {
    providerId: slot.eventType.resourceId,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    customerName: input.customerName,
    contactPhone: input.contactPhone,
    startAt: slot.startAt.toJSDate(),
    endAt: slot.endAt.toJSDate(),
    timezone: settings.timezone,
    eventType: slot.eventType.key,
    ...(notes ? { notes } : {}),
    updatedAt: now,
  };
  const update: UpdateFilter<AppointmentDocument> = { $set: setFields };
  if (!input.customerId || !notes) {
    update.$unset = {
      ...(!input.customerId ? { customerId: "" as const } : {}),
      ...(!notes ? { notes: "" as const } : {}),
    };
  }
  try {
    const appointment = await appointments.findOneAndUpdate(
      { _id: appointmentId, source: "manual", status: "scheduled", updatedAt: current.updatedAt },
      update,
      { returnDocument: "after" },
    );
    if (!appointment) throw new Error("O evento foi alterado por outra operação. Atualize a agenda e tente novamente.");
    if (input.customerId && !current.customerId?.equals(input.customerId)) {
      await scheduleFirstAppointmentQualification(input.customerId, appointment._id, appointment.updatedAt);
    }
    return appointment;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error("Já existe um evento para este profissional no horário escolhido.");
    }
    throw error;
  }
}

export async function updateCustomerAppointment(input: {
  appointmentId: ObjectId;
  customerId: ObjectId;
  startAt?: string;
  eventType?: string;
  notes?: string | null;
}) {
  const [appointment] = await updateCustomerAppointments({
    customerId: input.customerId,
    appointments: [{
      appointmentId: input.appointmentId,
      startAt: input.startAt,
      eventType: input.eventType,
      notes: input.notes,
    }],
  });
  return appointment;
}

export async function updateCustomerAppointments(input: {
  customerId: ObjectId;
  appointments: Array<{
    appointmentId: ObjectId;
    startAt?: string;
    eventType?: string;
    notes?: string | null;
  }>;
}) {
  if (input.appointments.length === 0 || input.appointments.length > 10) {
    throw new Error("Informe de um a dez eventos para alteração.");
  }
  const settings = await getCalendarSettings();
  const appointments = await getAppointmentsCollection();
  const appointmentIds = input.appointments.map((appointment) => appointment.appointmentId);
  if (new Set(appointmentIds.map((appointmentId) => appointmentId.toHexString())).size !== appointmentIds.length) {
    throw new Error("Cada evento deve aparecer uma única vez na alteração.");
  }
  const currentAppointments = await appointments.find({
    _id: { $in: appointmentIds },
    customerId: input.customerId,
    status: "scheduled",
  }).toArray();
  if (currentAppointments.length !== appointmentIds.length) throw new Error("Um ou mais eventos não foram encontrados para este cliente.");
  const currentById = new Map(currentAppointments.map((appointment) => [appointment._id.toHexString(), appointment]));
  const prepared: Array<{
    current: AppointmentDocument;
    update: (typeof input.appointments)[number];
    eventType: string;
    providerId: string;
    nextStart: DateTime;
    nextEnd: DateTime;
  }> = [];

  for (const update of input.appointments) {
    const current = currentById.get(update.appointmentId.toHexString())!;
    const eventType = update.eventType ?? current.eventType;
    const eventDefinition = settings.eventTypes.find((item) => item.key === eventType);
    if (!eventDefinition) throw new Error("Tipo de evento inválido.");
    const requested = update.startAt
      ? DateTime.fromISO(update.startAt, { setZone: true }).setZone(settings.timezone)
      : DateTime.fromJSDate(current.startAt).setZone(settings.timezone);
    if (!requested.isValid || requested <= DateTime.now().setZone(settings.timezone)) {
      throw new Error("O novo horário deve ser uma data futura válida.");
    }
    let nextStart = DateTime.fromJSDate(current.startAt).toUTC();
    let nextEnd = DateTime.fromJSDate(current.endAt).toUTC();
    if (update.startAt || eventType !== current.eventType) {
      const available = await findAvailableSlots({
        fromDate: requested.toISODate()!,
        toDate: requested.toISODate()!,
        eventType,
        limit: 50,
        excludeAppointmentIds: appointmentIds,
      });
      const slot = available.slots.find((item) => (
        DateTime.fromISO(item.startAt).toUTC().toMillis() === requested.toUTC().toMillis()
      ));
      if (!slot) throw new Error(`O novo horário de ${eventDefinition.name} não está disponível.`);
      nextStart = DateTime.fromISO(slot.startAt).toUTC();
      nextEnd = DateTime.fromISO(slot.endAt).toUTC();
    }
    prepared.push({ current, update, eventType, providerId: eventDefinition.resourceId, nextStart, nextEnd });
  }

  for (let firstIndex = 0; firstIndex < prepared.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < prepared.length; secondIndex += 1) {
      const first = prepared[firstIndex];
      const second = prepared[secondIndex];
      if (first.providerId === second.providerId && first.nextStart < second.nextEnd && first.nextEnd > second.nextStart) {
        throw new Error("Os novos horários informados têm conflito entre si.");
      }
    }
  }

  const now = new Date();
  const client = await clientPromise;
  const session = client.startSession();
  let updatedAppointments: AppointmentDocument[] = [];
  try {
    await session.withTransaction(async () => {
      const result = await appointments.bulkWrite(prepared.map(({ current, update, eventType, providerId, nextStart, nextEnd }) => ({
        updateOne: {
          filter: { _id: current._id, customerId: input.customerId, status: "scheduled", updatedAt: current.updatedAt },
          update: {
            $set: {
              startAt: nextStart.toJSDate(),
              endAt: nextEnd.toJSDate(),
              eventType,
              providerId,
              ...(update.notes?.trim() ? { notes: update.notes.trim().slice(0, 1_000) } : {}),
              updatedAt: now,
            },
            ...(update.notes !== undefined && !update.notes?.trim() ? { $unset: { notes: "" } } : {}),
          },
        },
      })), { ordered: true, session });
      if (result.modifiedCount !== prepared.length) throw new Error("Um ou mais eventos foram alterados por outra operação.");
      updatedAppointments = await appointments.find({ _id: { $in: appointmentIds } }, { session }).toArray();
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error("Já existe um evento deste tipo no novo horário.");
    }
    throw error;
  } finally {
    await session.endSession();
  }
  const updatedById = new Map(updatedAppointments.map((appointment) => [appointment._id.toHexString(), appointment]));
  return appointmentIds.map((appointmentId) => updatedById.get(appointmentId.toHexString())!);
}

async function persistAppointment(
  input: PersistAppointmentInput,
  settings: CalendarSettingsDocument,
  startAt: DateTime,
  endAt: DateTime,
) {
  const appointments = await getAppointmentsCollection();
  await ensureCalendarIndexes();
  const now = new Date();
  const appointment: AppointmentDocument = {
    _id: new ObjectId(),
    providerId: settings.eventTypes.find((item) => item.key === input.eventType)?.resourceId ?? settings.providerId,
    customerId: input.customerId,
    customerName: input.customerName,
    contactPhone: input.contactPhone,
    startAt: startAt.toJSDate(),
    endAt: endAt.toJSDate(),
    timezone: settings.timezone,
    status: input.status ?? "scheduled",
    holdExpiresAt: input.holdExpiresAt,
    schedulingOptionId: input.schedulingOptionId,
    notes: input.notes?.trim().slice(0, 1_000),
    eventType: input.eventType ?? settings.eventTypes[0].key,
    visitGroupId: input.visitGroupId,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await appointments.insertOne(appointment);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error("Já existe um evento deste tipo no horário escolhido.");
    }
    throw error;
  }

  return appointment;
}

export async function cancelAppointment(id: string) {
  if (!ObjectId.isValid(id)) throw new Error("Consulta inválida.");
  const appointmentId = new ObjectId(id);
  const now = new Date();
  const result = await (await getAppointmentsCollection()).findOneAndUpdate(
    { _id: appointmentId, status: "scheduled" },
    { $set: { status: "cancelled", updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!result) throw new Error("Consulta não encontrada ou já encerrada.");
  return result;
}

export async function deleteAppointment(id: string) {
  if (!ObjectId.isValid(id)) throw new Error("Evento inválido.");
  const appointmentId = new ObjectId(id);
  const result = await (await getAppointmentsCollection()).findOneAndDelete({ _id: appointmentId });
  if (!result) throw new Error("Evento não encontrado.");
  return result;
}

export async function getCustomerCalendarOverview(customerId: ObjectId) {
  const [appointment, settings] = await Promise.all([
    (await getAppointmentsCollection()).findOne(
      { customerId, status: "scheduled", startAt: { $gte: new Date() } },
      { sort: { startAt: 1 } },
    ),
    getCalendarSettings(),
  ]);
  const professionalName = appointment
    ? settings.resources.find((resource) => resource.id === appointment.providerId)?.name ?? null
    : null;
  return { appointment, professionalName };
}

export async function ensureCalendarIndexes() {
  const appointments = await getAppointmentsCollection();
  const accessEvents = await getAccessEventsCollection();
  const indexes = await appointments.indexes().catch((error) => {
    if (error instanceof MongoServerError && error.code === 26) return [];
    throw error;
  });
  const activeAppointmentIndexName = "unique_active_appointment_start";
  const legacyIndexes = indexes.filter((index) => (
    index.unique === true &&
    index.key?.providerId === 1 &&
    index.key?.startAt === 1 &&
    index.key?.eventType === undefined &&
    index.name !== activeAppointmentIndexName
  ));
  await appointments.createIndex(
    { providerId: 1, startAt: 1 },
    {
      name: activeAppointmentIndexName,
      unique: true,
      partialFilterExpression: { status: { $in: ["held", "scheduled"] } },
    },
  );
  await Promise.all(legacyIndexes.flatMap((index) => index.name ? [
    appointments.dropIndex(index.name).catch((error) => {
      if (!(error instanceof MongoServerError) || error.code !== 27) throw error;
    }),
  ] : []));
  await Promise.all([
    appointments.createIndex({ customerId: 1, startAt: -1 }),
    appointments.createIndex({ holdExpiresAt: 1 }, { expireAfterSeconds: 0 }),
    accessEvents.createIndex({ startAt: 1, endAt: 1 }),
    accessEvents.createIndex({ resourceIds: 1, startAt: 1 }),
  ]);
}

function validateSettings(input: {
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  weeklyAvailability: WeeklyAvailability[];
  resources: CalendarResourceDefinition[];
  eventTypes: CalendarEventTypeDefinition[];
}) {
  if (!input.providerName.trim()) throw new Error("Informe o nome do profissional.");
  if (!DateTime.now().setZone(input.timezone).isValid) throw new Error("Fuso horário inválido.");
  if (!validSlotDurations.has(input.slotDurationMinutes)) {
    throw new Error("Duração de consulta inválida.");
  }
  if (!Number.isFinite(input.minimumNoticeHours) || input.minimumNoticeHours < 0 || input.minimumNoticeHours > 720) throw new Error("Antecedência inválida.");
  if (input.eventTypes.length === 0 || input.eventTypes.length > 20) throw new Error("Configure entre 1 e 20 tipos de evento.");
  if (input.resources.length === 0 || input.resources.length > 20) throw new Error("Configure entre 1 e 20 recursos de agenda.");
  const resourceIds = new Set<string>();
  for (const resource of input.resources) {
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(resource.id) || !resource.name.trim()) throw new Error("Recurso de agenda inválido.");
    if (resourceIds.has(resource.id)) throw new Error("As chaves dos recursos devem ser únicas.");
    resourceIds.add(resource.id);
    validateWeeklyAvailability(resource.weeklyAvailability);
  }
  const eventTypeKeys = new Set<string>();
  for (const eventType of input.eventTypes) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(eventType.key) || !eventType.name.trim() || !/^#[0-9A-Fa-f]{6}$/.test(eventType.color) || !/^[a-z][a-z0-9_-]{1,39}$/.test(eventType.resourceId)) {
      throw new Error("Tipo de evento inválido.");
    }
    if (!Number.isInteger(eventType.durationMinutes) || eventType.durationMinutes < 5 || eventType.durationMinutes > 480) {
      throw new Error("A duração do tipo deve estar entre 5 e 480 minutos.");
    }
    if (eventTypeKeys.has(eventType.key)) throw new Error("As chaves dos tipos de evento devem ser únicas.");
    if (!resourceIds.has(eventType.resourceId)) throw new Error("O tipo de evento aponta para um recurso inexistente.");
    eventTypeKeys.add(eventType.key);
  }
  validateWeeklyAvailability(input.weeklyAvailability);
}

function validateWeeklyAvailability(weeklyAvailability: WeeklyAvailability[]) {
  if (weeklyAvailability.length !== 7) throw new Error("Configure os sete dias da semana.");
  for (const item of weeklyAvailability) {
    if (item.weekday < 1 || item.weekday > 7 || !Array.isArray(item.intervals)) {
      throw new Error("Configuração semanal inválida.");
    }
    if (item.enabled && item.intervals.length === 0) {
      throw new Error("Dias de atendimento precisam de ao menos um intervalo.");
    }
    const sorted = [...item.intervals].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const [index, interval] of sorted.entries()) {
      if (!/^\d{2}:\d{2}$/.test(interval.startTime) || !/^\d{2}:\d{2}$/.test(interval.endTime) || interval.startTime >= interval.endTime) {
        throw new Error("Intervalo semanal inválido.");
      }
      if (index > 0 && sorted[index - 1].endTime > interval.startTime) {
        throw new Error("Os intervalos de um mesmo dia não podem se sobrepor.");
      }
    }
  }
}

function normalizeWeeklyAvailability(value: unknown): WeeklyAvailability[] {
  if (!Array.isArray(value)) return defaultWeek;
  return value.map((raw, index) => {
    const day = raw as {
      weekday?: number;
      enabled?: boolean;
      intervals?: Array<{ startTime: string; endTime: string }>;
      startTime?: string;
      endTime?: string;
    };
    const intervals = Array.isArray(day.intervals)
      ? day.intervals
      : day.startTime && day.endTime
        ? [{ startTime: day.startTime, endTime: day.endTime }]
        : [];
    return {
      weekday: day.weekday ?? index + 1,
      enabled: Boolean(day.enabled),
      intervals,
    };
  });
}

function normalizeSlotDuration(value: unknown) {
  return typeof value === "number" && validSlotDurations.has(value)
    ? value
    : DEFAULT_SLOT_DURATION_MINUTES;
}

function atLocalTime(day: DateTime, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

function formatLocalTime(value: Date, timezone: string) {
  return DateTime.fromJSDate(value).setZone(timezone).toFormat("HH:mm");
}

async function validateManualAppointmentSlot(input: {
  settings: CalendarSettingsDocument;
  startAt: string;
  eventTypeKey?: string;
  excludeAppointmentId?: ObjectId;
}) {
  const requested = DateTime.fromISO(input.startAt, { zone: input.settings.timezone, setZone: true });
  if (!requested.isValid) throw new Error("Data do agendamento inválida.");
  if (requested <= DateTime.now().setZone(input.settings.timezone)) {
    throw new Error("O evento manual deve começar em uma data e hora futuras.");
  }
  const eventType = input.settings.eventTypes.find((item) => item.key === input.eventTypeKey);
  if (!eventType) throw new Error("Tipo de evento inválido.");
  const resource = input.settings.resources.find((item) => item.id === eventType.resourceId);
  if (!resource) throw new Error("O tipo de evento aponta para um profissional inexistente.");
  const endAt = requested.plus({ minutes: eventType.durationMinutes });
  const availability = resource.weeklyAvailability.find((item) => item.weekday === requested.weekday);
  const containingInterval = availability?.enabled
    ? availability.intervals.find((interval) => (
        requested >= atLocalTime(requested, interval.startTime)
        && endAt <= atLocalTime(requested, interval.endTime)
      ))
    : undefined;
  if (!containingInterval) {
    const configured = availability?.enabled && availability.intervals.length > 0
      ? availability.intervals.map((interval) => `${interval.startTime}–${interval.endTime}`).join(" ou ")
      : "sem expediente";
    throw new Error(`${eventType.name} precisa ficar integralmente no expediente de ${resource.name} (${configured} neste dia).`);
  }

  const requestedStartUtc = requested.toUTC();
  const requestedEndUtc = endAt.toUTC();
  const [accessEvents, conflictingAppointment] = await Promise.all([
    listCalendarAccessEvents(requestedStartUtc.toJSDate(), requestedEndUtc.toJSDate()),
    (await getAppointmentsCollection()).findOne({
      ...(input.excludeAppointmentId ? { _id: { $ne: input.excludeAppointmentId } } : {}),
      providerId: resource.id,
      status: "scheduled",
      startAt: { $lt: requestedEndUtc.toJSDate() },
      endAt: { $gt: requestedStartUtc.toJSDate() },
    }),
  ]);
  const accessDecision = getSlotAccessDecision(
    accessEvents,
    resource.id,
    requestedStartUtc.toJSDate(),
    requestedEndUtc.toJSDate(),
  );
  if (accessDecision.blocker) {
    throw new Error(
      `Conflita com o bloqueio “${accessDecision.blocker.title}” de ${formatLocalTime(accessDecision.blocker.startAt, input.settings.timezone)} a ${formatLocalTime(accessDecision.blocker.endAt, input.settings.timezone)} para ${resource.name}.`,
    );
  }
  if (!accessDecision.permitted) {
    throw new Error(`Não há uma permissão que cubra todo o período de ${requested.toFormat("HH:mm")} a ${endAt.toFormat("HH:mm")} para ${resource.name}.`);
  }
  if (conflictingAppointment) {
    throw new Error(
      `Conflita com outro evento de ${resource.name} de ${formatLocalTime(conflictingAppointment.startAt, input.settings.timezone)} a ${formatLocalTime(conflictingAppointment.endAt, input.settings.timezone)}.`,
    );
  }
  return { startAt: requestedStartUtc, endAt: requestedEndUtc, eventType };
}

function normalizeEventTypes(value: unknown, fallbackDuration = 30): CalendarEventTypeDefinition[] {
  if (!Array.isArray(value) || value.length === 0) return defaultEventTypes;
  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const eventType = item as Partial<CalendarEventTypeDefinition>;
    if (typeof eventType.key !== "string" || typeof eventType.name !== "string" ||
      typeof eventType.color !== "string") return [];
    const defaultType = defaultEventTypes.find((candidate) => candidate.key === eventType.key);
    return [{
      key: eventType.key,
      name: eventType.name,
      color: eventType.color,
      resourceId: eventType.resourceId ?? defaultType?.resourceId ?? "doctor",
      durationMinutes: Number.isInteger(eventType.durationMinutes)
        ? eventType.durationMinutes as number
        : defaultType?.durationMinutes ?? fallbackDuration,
    }];
  });
  const requiredKeys = new Set(["doctor_consultation", "bioimpedance"]);
  const withRequired = [...normalized];
  for (const required of defaultEventTypes.filter((item) => requiredKeys.has(item.key))) {
    if (!withRequired.some((item) => item.key === required.key)) withRequired.push(required);
  }
  return withRequired.length > 0 ? withRequired : defaultEventTypes;
}

function normalizeResources(value: unknown, fallback: WeeklyAvailability[]): CalendarResourceDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultResources.map((resource) => ({ ...resource, weeklyAvailability: fallback }));
  }
  const resources = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const resource = item as Partial<CalendarResourceDefinition>;
    if (typeof resource.id !== "string" || typeof resource.name !== "string") return [];
    return [{
      id: resource.id,
      name: resource.name,
      weeklyAvailability: normalizeWeeklyAvailability(resource.weeklyAvailability),
    }];
  });
  for (const required of defaultResources) {
    if (!resources.some((resource) => resource.id === required.id)) {
      resources.push({ ...required, weeklyAvailability: fallback });
    }
  }
  return resources;
}