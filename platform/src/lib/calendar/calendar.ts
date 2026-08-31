import "server-only";

import { Collection, MongoServerError, ObjectId } from "mongodb";
import { DateTime, Interval } from "luxon";
import clientPromise from "../mongodb";

export interface WeeklyAvailability {
  weekday: number;
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

export interface CalendarSettingsDocument {
  _id: string;
  providerId: string;
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  followUpHoursBefore: number;
  weeklyAvailability: WeeklyAvailability[];
  updatedAt: Date;
}

export interface AppointmentDocument {
  _id: ObjectId;
  providerId: string;
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  status: "scheduled" | "cancelled" | "completed";
  notes?: string;
  source: "assistant" | "manual";
  messageSource: "meta" | "simulator";
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowUpTriggerDocument {
  _id: ObjectId;
  appointmentId: ObjectId;
  customerId: ObjectId;
  type: "appointment_reminder";
  dueAt: Date;
  status: "pending" | "processing" | "awaiting_response" | "completed" | "cancelled" | "failed";
  leaseUntil?: Date;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AvailableSlot {
  startAt: string;
  endAt: string;
  label: string;
}

const DB_NAME = "ai_secretary";
export const DEFAULT_PROVIDER_ID = "default-doctor";
const SETTINGS_ID = "default-calendar";

const defaultWeek: WeeklyAvailability[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    enabled: true,
    intervals: [{ startTime: "09:00", endTime: "12:00" }, { startTime: "13:00", endTime: "17:00" }],
  })),
  { weekday: 6, enabled: false, intervals: [{ startTime: "09:00", endTime: "13:00" }] },
  { weekday: 7, enabled: false, intervals: [{ startTime: "09:00", endTime: "13:00" }] },
];

async function getSettingsCollection(): Promise<Collection<CalendarSettingsDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CalendarSettingsDocument>("calendar_settings");
}

async function getAppointmentsCollection(): Promise<Collection<AppointmentDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AppointmentDocument>("calendar_appointments");
}

async function getTriggersCollection(): Promise<Collection<FollowUpTriggerDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FollowUpTriggerDocument>("assistant_scheduled_triggers");
}

export async function getCalendarSettings() {
  const settings = await getSettingsCollection();
  const existing = await settings.findOne({ _id: SETTINGS_ID });
  if (existing) {
    const weeklyAvailability = normalizeWeeklyAvailability(existing.weeklyAvailability);
    if (JSON.stringify(weeklyAvailability) !== JSON.stringify(existing.weeklyAvailability)) {
      await settings.updateOne(
        { _id: SETTINGS_ID },
        { $set: { weeklyAvailability, updatedAt: new Date() } },
      );
    }
    return { ...existing, weeklyAvailability };
  }
  const initial: CalendarSettingsDocument = {
    _id: SETTINGS_ID,
    providerId: DEFAULT_PROVIDER_ID,
    providerName: "Dr(a). responsável",
    timezone: "America/Sao_Paulo",
    slotDurationMinutes: 30,
    minimumNoticeHours: 2,
    followUpHoursBefore: 24,
    weeklyAvailability: defaultWeek,
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
  followUpHoursBefore: number;
  weeklyAvailability: WeeklyAvailability[];
}) {
  validateSettings(input);
  const current = await getCalendarSettings();
  const next: CalendarSettingsDocument = {
    ...current,
    providerName: input.providerName.trim().slice(0, 100),
    timezone: input.timezone,
    slotDurationMinutes: input.slotDurationMinutes,
    minimumNoticeHours: input.minimumNoticeHours,
    followUpHoursBefore: input.followUpHoursBefore,
    weeklyAvailability: input.weeklyAvailability,
    updatedAt: new Date(),
  };
  await (await getSettingsCollection()).replaceOne({ _id: SETTINGS_ID }, next, { upsert: true });
  return next;
}

export async function listAppointments(from: Date, to: Date) {
  return (await getAppointmentsCollection())
    .find({ startAt: { $gte: from, $lt: to } })
    .sort({ startAt: 1 })
    .toArray();
}

export async function findAvailableSlots(input: {
  fromDate: string;
  toDate: string;
  period?: "morning" | "afternoon" | "any";
  limit?: number;
}) {
  const settings = await getCalendarSettings();
  const startDay = DateTime.fromISO(input.fromDate, { zone: settings.timezone }).startOf("day");
  const endDay = DateTime.fromISO(input.toDate, { zone: settings.timezone }).endOf("day");
  if (!startDay.isValid || !endDay.isValid || endDay < startDay) {
    throw new Error("Período de busca inválido.");
  }
  if (endDay.diff(startDay, "days").days > 31) {
    throw new Error("A busca de disponibilidade deve cobrir no máximo 31 dias.");
  }

  const appointments = await listAppointments(startDay.toUTC().toJSDate(), endDay.toUTC().toJSDate());
  const occupied = appointments
    .filter((appointment) => appointment.status === "scheduled")
    .map((appointment) => Interval.fromDateTimes(
      DateTime.fromJSDate(appointment.startAt),
      DateTime.fromJSDate(appointment.endAt),
    ));
  const earliest = DateTime.now().setZone(settings.timezone).plus({ hours: settings.minimumNoticeHours });
  const slots: AvailableSlot[] = [];
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);

  for (let day = startDay; day <= endDay && slots.length < limit; day = day.plus({ days: 1 })) {
    const availability = settings.weeklyAvailability.find((item) => item.weekday === day.weekday);
    if (!availability?.enabled) continue;
    for (const interval of availability.intervals) {
      let cursor = atLocalTime(day, interval.startTime);
      const intervalEnd = atLocalTime(day, interval.endTime);
      while (cursor.plus({ minutes: settings.slotDurationMinutes }) <= intervalEnd && slots.length < limit) {
        const slotEnd = cursor.plus({ minutes: settings.slotDurationMinutes });
        const slotInterval = Interval.fromDateTimes(cursor.toUTC(), slotEnd.toUTC());
        const periodMatches = input.period === "morning"
          ? cursor.hour < 12
          : input.period === "afternoon"
            ? cursor.hour >= 12
            : true;
        if (cursor >= earliest && periodMatches && !occupied.some((item) => item.overlaps(slotInterval))) {
          slots.push({
            startAt: cursor.toISO()!,
            endAt: slotEnd.toISO()!,
            label: cursor.setLocale("pt-BR").toFormat("ccc, dd/LL 'às' HH:mm"),
          });
        }
        cursor = slotEnd;
      }
    }
  }
  return { settings, slots };
}

export async function bookAppointment(input: {
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  startAt: string;
  notes?: string;
  source: "assistant" | "manual";
  messageSource: "meta" | "simulator";
}) {
  const settings = await getCalendarSettings();
  const requested = DateTime.fromISO(input.startAt, { setZone: true }).setZone(settings.timezone);
  if (!requested.isValid) throw new Error("Data do agendamento inválida.");
  const date = requested.toISODate();
  const available = await findAvailableSlots({ fromDate: date!, toDate: date!, limit: 50 });
  const slot = available.slots.find((item) => DateTime.fromISO(item.startAt).toUTC().toMillis() === requested.toUTC().toMillis());
  if (!slot) throw new Error("O horário escolhido não está mais disponível.");

  const appointments = await getAppointmentsCollection();
  await ensureCalendarIndexes();
  const now = new Date();
  const appointment: AppointmentDocument = {
    _id: new ObjectId(),
    providerId: settings.providerId,
    customerId: input.customerId,
    customerName: input.customerName,
    contactPhone: input.contactPhone,
    startAt: DateTime.fromISO(slot.startAt).toUTC().toJSDate(),
    endAt: DateTime.fromISO(slot.endAt).toUTC().toJSDate(),
    timezone: settings.timezone,
    status: "scheduled",
    notes: input.notes?.trim().slice(0, 1_000),
    source: input.source,
    messageSource: input.messageSource,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await appointments.insertOne(appointment);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error("O horário acabou de ser reservado por outro atendimento.");
    }
    throw error;
  }

  const dueAt = DateTime.fromJSDate(appointment.startAt)
    .minus({ hours: settings.followUpHoursBefore })
    .toJSDate();
  if (dueAt > now) {
    await (await getTriggersCollection()).insertOne({
      _id: new ObjectId(),
      appointmentId: appointment._id,
      customerId: input.customerId,
      type: "appointment_reminder",
      dueAt,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
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
  await (await getTriggersCollection()).updateMany(
    { appointmentId, status: "pending" },
    { $set: { status: "cancelled", updatedAt: now } },
  );
  return result;
}

export async function listScheduledTriggers(limit = 100, from?: Date, to?: Date) {
  return (await getTriggersCollection())
    .find(from && to ? { dueAt: { $gte: from, $lt: to } } : {})
    .sort({ dueAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .toArray();
}

export async function getCustomerCalendarOverview(customerId: ObjectId) {
  const appointment = await (await getAppointmentsCollection()).findOne(
    { customerId, status: "scheduled", startAt: { $gte: new Date() } },
    { sort: { startAt: 1 } },
  );
  if (!appointment) return { appointment: null, trigger: null };
  const trigger = await (await getTriggersCollection()).findOne({ appointmentId: appointment._id });
  return { appointment, trigger };
}

export async function claimDueFollowUpTrigger(leaseMs: number) {
  const triggers = await getTriggersCollection();
  const now = new Date();
  const trigger = await triggers.findOneAndUpdate(
    {
      $or: [
        { status: "pending", dueAt: { $lte: now } },
        { status: "processing", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseUntil: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  );
  if (!trigger) return null;
  const appointment = await (await getAppointmentsCollection()).findOne({
    _id: trigger.appointmentId,
    status: "scheduled",
  });
  if (!appointment) {
    await triggers.updateOne(
      { _id: trigger._id },
      { $set: { status: "cancelled", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
    );
    return null;
  }
  return { trigger, appointment };
}

export async function completeFollowUpTrigger(id: ObjectId) {
  await (await getTriggersCollection()).updateOne(
    { _id: id, status: "processing" },
    { $set: { status: "completed", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
  );
}

export async function failFollowUpTrigger(id: ObjectId, attempts: number) {
  await (await getTriggersCollection()).updateOne(
    { _id: id, status: "processing" },
    {
      $set: {
        status: attempts >= 5 ? "failed" : "pending",
        dueAt: new Date(Date.now() + Math.min(60_000 * 2 ** (attempts - 1), 30 * 60_000)),
        updatedAt: new Date(),
      },
      $unset: { leaseUntil: "" },
    },
  );
}

export async function ensureCalendarIndexes() {
  const appointments = await getAppointmentsCollection();
  const triggers = await getTriggersCollection();
  await Promise.all([
    appointments.createIndex(
      { providerId: 1, startAt: 1 },
      { unique: true, partialFilterExpression: { status: "scheduled" } },
    ),
    appointments.createIndex({ customerId: 1, startAt: -1 }),
    triggers.createIndex({ status: 1, dueAt: 1 }),
    triggers.createIndex({ appointmentId: 1 }, { unique: true }),
  ]);
}

function validateSettings(input: {
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  followUpHoursBefore: number;
  weeklyAvailability: WeeklyAvailability[];
}) {
  if (!input.providerName.trim()) throw new Error("Informe o nome do profissional.");
  if (!DateTime.now().setZone(input.timezone).isValid) throw new Error("Fuso horário inválido.");
  if (![15, 20, 30, 45, 60, 90, 120].includes(input.slotDurationMinutes)) {
    throw new Error("Duração de consulta inválida.");
  }
  if (!Number.isFinite(input.minimumNoticeHours) || input.minimumNoticeHours < 0 || input.minimumNoticeHours > 720) throw new Error("Antecedência inválida.");
  if (!Number.isFinite(input.followUpHoursBefore) || input.followUpHoursBefore < 1 || input.followUpHoursBefore > 720) throw new Error("Prazo de follow-up inválido.");
  if (input.weeklyAvailability.length !== 7) throw new Error("Configure os sete dias da semana.");
  for (const item of input.weeklyAvailability) {
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

function atLocalTime(day: DateTime, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

export async function markFollowUpTriggerAwaitingResponse(id: ObjectId) {
  await (await getTriggersCollection()).updateOne(
    { _id: id, status: "processing" },
    { $set: { status: "awaiting_response", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
  );
}

export async function completeAwaitingFollowUpTrigger(customerId: ObjectId) {
  await (await getTriggersCollection()).updateOne(
    { customerId, status: "awaiting_response" },
    { $set: { status: "completed", updatedAt: new Date() } },
  );
}