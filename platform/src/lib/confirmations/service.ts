import "server-only";

import { DateTime } from "luxon";
import { ObjectId, type Collection } from "mongodb";
import {
  findAppointmentsByIds, getCalendarSettings, listAppointmentsAwaitingConfirmation, setAppointmentsConfirmation,
  type AppointmentDocument,
} from "../calendar";
import { runWithCompany, withCurrentCompany } from "../companies/context";
import { isCompanyOperational } from "../companies/status";
import { tenantDb } from "../companies/tenant-db";
import { findCustomerById, updateCustomerServiceStatus } from "../crm";
import { sendTextMessage, sendWhatsAppTemplate } from "../whatsapp/client";
import { saveWhatsAppMessage } from "../whatsapp/messages";
import { getAppointmentConfirmationConfiguration, listConfirmationEnabledCompanyIds, type AppointmentConfirmationConfiguration } from "./config";
import { getConfirmationTemplateStatus } from "./template";
import {
  CONFIRMATION_BUTTONS, confirmationPayload, parseConfirmationPayload, renderConfirmationBody, templateParameter,
  type ConfirmationAction,
} from "./template-content";
import {
  clinicLocalDate, confirmationStatusAfterPayment, eligibleForReminders, nextReminderAt, plannedFirstSend, replyDeadline, windowStartAtOrAfter,
  type ConfirmationTimingPolicy,
} from "./timing";

export type ConfirmationStatus =
  | "awaiting_reply" | "confirmed" | "reschedule_requested" | "cancel_requested" | "unconfirmed" | "obsolete" | "failed";

/** One reminder cycle: a patient's events of one clinic day that were "A confirmar" when it started. */
export interface AppointmentConfirmationDocument {
  _id: ObjectId;
  companyId?: ObjectId;
  customerId: ObjectId;
  /** Clinic-local date (YYYY-MM-DD) of the events. */
  localDate: string;
  timezone: string;
  appointmentIds: ObjectId[];
  firstStartAt: Date;
  status: ConfirmationStatus;
  attempts: Array<{ at: Date; messageId?: string; error?: string }>;
  nextAttemptAt: Date | null;
  /** After the last reminder: when the events become "Sem confirmação" without an answer. */
  deadlineAt: Date | null;
  response?: { action: ConfirmationAction; at: Date; source: "button" | "assistant"; late?: boolean };
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OPEN_STATUSES: ConfirmationStatus[] = ["awaiting_reply", "reschedule_requested"];
const RUN_EVERY_MS = 60_000;
let lastRunAt = 0;

async function getCollection(): Promise<Collection<AppointmentConfirmationDocument>> {
  const collection = (await tenantDb()).collection<AppointmentConfirmationDocument>("appointment_confirmations");
  await ensureIndexes(collection);
  return collection;
}

let indexesReady: Promise<unknown> | undefined;
function ensureIndexes(collection: Collection<AppointmentConfirmationDocument>) {
  indexesReady ??= Promise.all([
    collection.createIndex({ companyId: 1, customerId: 1, localDate: 1 }, { unique: true, name: "company_customer_day_unique" }),
    collection.createIndex({ companyId: 1, status: 1, nextAttemptAt: 1 }),
    collection.createIndex({ companyId: 1, status: 1, deadlineAt: 1 }),
  ]).catch((error) => { indexesReady = undefined; throw error; });
  return indexesReady;
}

/** Worker step (at most once a minute): plans, sends and closes reminder cycles of every clinic with the task on. */
export async function processAppointmentConfirmations(now = new Date()) {
  const elapsed = now.getTime() - lastRunAt;
  if (elapsed >= 0 && elapsed < RUN_EVERY_MS) return { skipped: true as const };
  lastRunAt = now.getTime();
  const totals = { companies: 0, planned: 0, sent: 0, unconfirmed: 0 };
  for (const companyId of await listConfirmationEnabledCompanyIds()) {
    if (!(await isCompanyOperational(companyId))) continue;
    try {
      const result = await runWithCompany(companyId, () => processCompany(now));
      totals.companies += 1;
      totals.planned += result.planned;
      totals.sent += result.sent;
      totals.unconfirmed += result.unconfirmed;
    } catch (error) {
      console.error("Appointment confirmations failed.", { company: companyId.toHexString(), error: error instanceof Error ? error.message.slice(0, 200) : "Unknown" });
    }
  }
  return totals;
}

async function processCompany(now: Date) {
  const config = await getAppointmentConfirmationConfiguration();
  const empty = { planned: 0, sent: 0, unconfirmed: 0 };
  if (!config.enabled) return empty;
  const settings = await getCalendarSettings();
  const policy: ConfirmationTimingPolicy = { ...config, timezone: settings.timezone };
  // Deadlines don't send anything, so they run even when the template can't be used.
  const unconfirmed = await closeExpiredCycles(now);
  const template = await getConfirmationTemplateStatus();
  if (template.state !== "approved") return { ...empty, unconfirmed };
  const planned = await planCycles(now, config, policy);
  const sent = await sendDueReminders(now, config, policy, settings.eventTypes);
  return { planned, sent, unconfirmed };
}

async function planCycles(now: Date, config: AppointmentConfirmationConfiguration, policy: ConfirmationTimingPolicy) {
  // A cycle is due once its first reminder time has passed, which never happens more than
  // firstSendHoursBefore ahead of the event.
  const appointments = await listAppointmentsAwaitingConfirmation({
    from: now, to: new Date(now.getTime() + (config.firstSendHoursBefore + 1) * 3_600_000),
  });
  const groups = new Map<string, AppointmentDocument[]>();
  for (const appointment of appointments) {
    const key = `${appointment.customerId!.toHexString()}:${clinicLocalDate(appointment.startAt, policy.timezone)}`;
    groups.set(key, [...(groups.get(key) ?? []), appointment]);
  }
  if (groups.size === 0) return 0;
  const collection = await getCollection();
  const existing = new Set((await collection.find(
    { customerId: { $in: [...new Set(appointments.map((appointment) => appointment.customerId!))] }, localDate: { $in: [...new Set([...groups.keys()].map((key) => key.split(":")[1]))] } },
    { projection: { customerId: 1, localDate: 1 } },
  ).toArray()).map((cycle) => `${cycle.customerId.toHexString()}:${cycle.localDate}`));

  let planned = 0;
  for (const [key, group] of groups) {
    if (existing.has(key)) continue;
    const firstSend = plannedFirstSend(group[0].startAt, policy);
    if (firstSend > now) continue;
    const eligible = group.filter((appointment) => eligibleForReminders(appointment, firstSend, config.skipRecentHours));
    if (eligible.length === 0) continue;
    const firstStartAt = eligible[0].startAt;
    const nextAttemptAt = windowStartAtOrAfter(now, policy);
    if (nextAttemptAt >= firstStartAt) continue;
    const cycle: AppointmentConfirmationDocument = {
      _id: new ObjectId(),
      customerId: eligible[0].customerId!,
      localDate: key.split(":")[1],
      timezone: policy.timezone,
      appointmentIds: eligible.map((appointment) => appointment._id),
      firstStartAt,
      status: "awaiting_reply",
      attempts: [],
      nextAttemptAt,
      deadlineAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await collection.updateOne(
      { customerId: cycle.customerId, localDate: cycle.localDate },
      { $setOnInsert: await withCurrentCompany(cycle) },
      { upsert: true },
    );
    if (result.upsertedCount > 0) planned += 1;
  }
  return planned;
}

async function sendDueReminders(
  now: Date,
  config: AppointmentConfirmationConfiguration,
  policy: ConfirmationTimingPolicy,
  eventTypes: Array<{ key: string; name: string }>,
) {
  const collection = await getCollection();
  let sent = 0;
  for (let index = 0; index < 20; index += 1) {
    const cycle = await collection.findOneAndUpdate(
      {
        status: "awaiting_reply", nextAttemptAt: { $lte: now },
        $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
      },
      { $set: { lockedUntil: new Date(now.getTime() + 2 * 60_000) } },
      { returnDocument: "after", sort: { nextAttemptAt: 1 } },
    );
    if (!cycle) break;
    const appointments = await stillAwaiting(cycle);
    if (appointments.length === 0) {
      await finish(cycle._id, { status: "obsolete", nextAttemptAt: null, deadlineAt: null });
      continue;
    }
    const firstStartAt = appointments[0].startAt;
    const sendAt = windowStartAtOrAfter(now, policy);
    if (sendAt > now || now >= firstStartAt) {
      // Outside the window, or the event already started: wait for the next window or stop sending.
      const next = sendAt < firstStartAt && now < firstStartAt ? sendAt : null;
      const lastSent = cycle.attempts.at(-1)?.at;
      await finish(cycle._id, next
        ? { nextAttemptAt: next }
        : lastSent
          ? { nextAttemptAt: null, deadlineAt: replyDeadline(lastSent, firstStartAt, policy) }
          : { status: "obsolete", nextAttemptAt: null, deadlineAt: null });
      continue;
    }
    const attempt = await sendReminder(cycle, appointments, config, eventTypes);
    const attempts = [...cycle.attempts, attempt];
    const next = attempts.length < config.maxAttempts ? nextReminderAt(now, firstStartAt, policy) : null;
    await finish(cycle._id, {
      attempts,
      appointmentIds: appointments.map((appointment) => appointment._id),
      firstStartAt,
      nextAttemptAt: next,
      deadlineAt: next ? null : replyDeadline(now, firstStartAt, policy),
    });
    if (!attempt.error) sent += 1;
  }
  return sent;
}

async function sendReminder(
  cycle: AppointmentConfirmationDocument,
  appointments: AppointmentDocument[],
  config: AppointmentConfirmationConfiguration,
  eventTypes: Array<{ key: string; name: string }>,
): Promise<AppointmentConfirmationDocument["attempts"][number]> {
  const at = new Date();
  try {
    const customer = await findCustomerById(cycle.customerId.toHexString());
    const phone = customer?.phones[0];
    if (!customer || !phone) return { at, error: "Paciente sem telefone." };
    const parameters = templateParameters(customer.name, appointments, cycle.timezone, eventTypes);
    const result = await sendWhatsAppTemplate({
      to: phone,
      name: config.template.name,
      language: config.template.language,
      bodyParameters: parameters,
      quickReplyPayloads: CONFIRMATION_BUTTONS.map((button, index) => ({ index, payload: confirmationPayload(cycle._id.toHexString(), button.action) })),
    });
    const template = await getConfirmationTemplateStatus();
    await saveWhatsAppMessage({
      customerId: customer._id,
      metaMessageId: result.messageId,
      contactPhone: result.to,
      contactName: customer.name,
      direction: "outbound",
      type: "template",
      body: `${renderConfirmationBody(template.body ?? config.template.body, parameters)}\n[${CONFIRMATION_BUTTONS.map((button) => button.text).join("] [")}]`,
      templateName: config.template.name,
      templateLanguage: config.template.language,
      status: "sent",
      sentBy: "Confirmação automática",
      timestamp: at,
    });
    return { at, messageId: result.messageId };
  } catch (error) {
    return { at, error: error instanceof Error ? error.message.slice(0, 300) : "Falha no envio." };
  }
}

/** Past the deadline without an answer: the events become "Sem confirmação" (the clinic decides what to do). */
async function closeExpiredCycles(now: Date) {
  const collection = await getCollection();
  const expired = await collection.find({ status: { $in: OPEN_STATUSES }, nextAttemptAt: null, deadlineAt: { $lte: now } }).limit(100).toArray();
  let unconfirmed = 0;
  for (const cycle of expired) {
    const appointments = await stillAwaiting(cycle);
    if (appointments.length > 0) {
      unconfirmed += await setAppointmentsConfirmation({
        appointmentIds: appointments.map((appointment) => appointment._id),
        customerId: cycle.customerId,
        from: ["pending", "missing"],
        to: "unconfirmed",
      });
    }
    await finish(cycle._id, { status: appointments.length > 0 ? "unconfirmed" : "obsolete", deadlineAt: null });
  }
  return unconfirmed;
}

/** Events of the cycle still booked on that day and awaiting confirmation ("A confirmar" or "Sem confirmação"). */
async function stillAwaiting(cycle: AppointmentConfirmationDocument, states: Array<"pending" | "unconfirmed"> = ["pending"]) {
  const appointments = await findAppointmentsByIds(cycle.appointmentIds);
  return appointments
    .filter((appointment) => appointment.status === "scheduled"
      && appointment.customerId?.equals(cycle.customerId)
      && clinicLocalDate(appointment.startAt, cycle.timezone) === cycle.localDate
      && (states.includes(appointment.confirmationStatus as "pending")
        || (states.includes("pending") && !appointment.confirmationStatus && appointment.source === "manual")))
    .sort((first, second) => first.startAt.getTime() - second.startAt.getTime());
}

async function finish(id: ObjectId, set: Partial<AppointmentConfirmationDocument>) {
  await (await getCollection()).updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date() }, $unset: { lockedUntil: "" } });
}

function templateParameters(name: string, appointments: AppointmentDocument[], timezone: string, eventTypes: Array<{ key: string; name: string }>) {
  const first = DateTime.fromJSDate(appointments[0].startAt).setZone(timezone).setLocale("pt-BR");
  const events = appointments.map((appointment) => {
    const local = DateTime.fromJSDate(appointment.startAt).setZone(timezone);
    const label = appointment.customTitle || eventTypes.find((eventType) => eventType.key === appointment.eventType)?.name || "Consulta";
    return `${local.toFormat("HH:mm")} ${label}`;
  });
  return [
    templateParameter(name.trim().split(/\s+/)[0] || "paciente"),
    templateParameter(first.toFormat("cccc, dd/MM")),
    templateParameter(events.join("; ")),
  ];
}

// --- Patient answers ---------------------------------------------------------------------------------------------

export type ConfirmationOutcome =
  | { kind: "confirmed"; appointments: AppointmentDocument[] }
  | { kind: "reschedule_requested"; appointments: AppointmentDocument[] }
  | { kind: "cancel_requested"; appointments: AppointmentDocument[] }
  | { kind: "late" }
  | { kind: "not_found" };

/**
 * Applies a patient's answer to a reminder cycle. Answers after the cycle closed ("Sem confirmação", or events
 * changed meanwhile) change nothing: the clinic decides. Oria never cancels a booking by itself.
 */
export async function applyConfirmationAnswer(input: {
  customerId: ObjectId;
  confirmationId?: ObjectId;
  action: ConfirmationAction;
  source: "button" | "assistant";
}): Promise<ConfirmationOutcome> {
  const collection = await getCollection();
  const cycle = input.confirmationId
    ? await collection.findOne({ _id: input.confirmationId, customerId: input.customerId })
    : await findAnswerableCycle(input.customerId);
  if (!cycle) return { kind: "not_found" };
  const now = new Date();
  if (cycle.status === "unconfirmed" || cycle.status === "obsolete" || cycle.status === "failed") {
    await collection.updateOne({ _id: cycle._id }, { $set: { response: { action: input.action, at: now, source: input.source, late: true }, updatedAt: now } });
    return { kind: "late" };
  }
  const appointments = await stillAwaiting(cycle, ["pending", "unconfirmed"]);
  const response = { action: input.action, at: now, source: input.source };
  if (input.action === "confirm") {
    await setAppointmentsConfirmation({
      appointmentIds: appointments.map((appointment) => appointment._id),
      customerId: cycle.customerId,
      from: ["pending", "missing", "unconfirmed"],
      to: "confirmed",
    });
    await finish(cycle._id, { status: "confirmed", response, nextAttemptAt: null, deadlineAt: null });
    return { kind: "confirmed", appointments };
  }
  if (input.action === "reschedule") {
    // The current time is kept until the patient picks another one; reminders stop meanwhile.
    const firstStartAt = appointments[0]?.startAt ?? cycle.firstStartAt;
    await finish(cycle._id, {
      status: "reschedule_requested", response, nextAttemptAt: null,
      deadlineAt: cycle.deadlineAt ?? replyDeadline(now, firstStartAt, await getAppointmentConfirmationConfiguration()),
    });
    return { kind: "reschedule_requested", appointments };
  }
  await finish(cycle._id, { status: "cancel_requested", response, nextAttemptAt: null, deadlineAt: null });
  return { kind: "cancel_requested", appointments };
}

/** The patient's most recent cycle that is still open, or closed less than a day ago (for late answers). */
async function findAnswerableCycle(customerId: ObjectId) {
  return (await getCollection()).findOne(
    { customerId, firstStartAt: { $gt: new Date(Date.now() - 24 * 3_600_000) }, status: { $in: [...OPEN_STATUSES, "unconfirmed", "confirmed", "cancel_requested"] } },
    { sort: { firstStartAt: 1 } },
  );
}

/** Reminder cycle shown to the AI: the open one for this patient, with its events. */
export async function getOpenConfirmationForCustomer(customerId: ObjectId) {
  const cycle = await (await getCollection()).findOne(
    { customerId, status: { $in: [...OPEN_STATUSES, "unconfirmed"] }, firstStartAt: { $gt: new Date() } },
    { sort: { firstStartAt: 1 } },
  );
  if (!cycle) return null;
  const [appointments, settings] = await Promise.all([stillAwaiting(cycle, ["pending", "unconfirmed"]), getCalendarSettings()]);
  return {
    status: cycle.status,
    localDate: cycle.localDate,
    remindersSent: cycle.attempts.filter((attempt) => !attempt.error).length,
    appointments: appointments.map((appointment) => {
      const local = DateTime.fromJSDate(appointment.startAt).setZone(cycle.timezone);
      return {
        eventType: appointment.eventType,
        eventTypeName: appointment.customTitle || settings.eventTypes.find((eventType) => eventType.key === appointment.eventType)?.name || appointment.eventType,
        localDate: local.toISODate(),
        localTime: local.toFormat("HH:mm"),
        startAt: appointment.startAt.toISOString(),
      };
    }),
  };
}

/**
 * A tap on a reminder button. Confirm and cancel are answered here, without the AI; "Escolher novo horário"
 * hands the conversation to the AI (even from human service) to find another time.
 */
export async function handleConfirmationButton(input: {
  customer: { _id: ObjectId; name: string; phones: string[] };
  payload: string | undefined;
}): Promise<{ handled: false } | { handled: true; runAgent: boolean }> {
  const parsed = parseConfirmationPayload(input.payload);
  if (!parsed) return { handled: false };
  const outcome = await applyConfirmationAnswer({
    customerId: input.customer._id,
    confirmationId: new ObjectId(parsed.confirmationId),
    action: parsed.action,
    source: "button",
  });
  if (outcome.kind === "not_found") return { handled: false };
  if (outcome.kind === "reschedule_requested") {
    await updateCustomerServiceStatus(input.customer._id, "ai_active");
    return { handled: true, runAgent: true };
  }
  if (outcome.kind === "late" || outcome.kind === "cancel_requested") await updateCustomerServiceStatus(input.customer._id, "waiting_human");
  const settings = await getCalendarSettings();
  const reply = outcome.kind === "confirmed"
    ? confirmedReply(outcome.appointments, settings.timezone)
    : outcome.kind === "cancel_requested"
      ? "Recebemos seu pedido de cancelamento. A equipe da clínica vai entrar em contato para concluir."
      : "Recebemos sua resposta. A equipe da clínica vai verificar seu horário e retornar em breve.";
  await replyToPatient(input.customer, reply);
  return { handled: true, runAgent: false };
}

function confirmedReply(appointments: AppointmentDocument[], timezone: string) {
  if (appointments.length === 0) return "Presença confirmada. Obrigado!";
  const first = DateTime.fromJSDate(appointments[0].startAt).setZone(timezone).setLocale("pt-BR");
  return `Presença confirmada! Te esperamos ${first.toFormat("cccc, dd/MM")} às ${first.toFormat("HH:mm")}.`;
}

async function replyToPatient(customer: { _id: ObjectId; name: string; phones: string[] }, body: string) {
  const phone = customer.phones[0];
  if (!phone) return;
  try {
    const sent = await sendTextMessage({ to: phone, body });
    await saveWhatsAppMessage({
      customerId: customer._id, metaMessageId: sent.messageId, contactPhone: phone, contactName: customer.name,
      direction: "outbound", type: "text", body, status: "sent", timestamp: new Date(),
    });
  } catch (error) {
    console.error("Confirmation reply failed.", { error: error instanceof Error ? error.message.slice(0, 200) : "Unknown" });
  }
}

/** Upcoming events with no answer to the reminders, for the clinic's alerts. */
export async function countUnconfirmedUpcoming() {
  return (await tenantDb()).collection("calendar_appointments").countDocuments({
    status: "scheduled", confirmationStatus: "unconfirmed", startAt: { $gt: new Date() },
  });
}

/**
 * After a deposit confirmed bookings ("A confirmar"): "Confirmado" right away when the task is off or the first event
 * is already within the reminder period (see confirmationStatusAfterPayment). Returns the resulting attendance.
 */
export async function applyAttendanceAfterPayment(input: {
  customerId: ObjectId;
  appointments: Array<{ _id: ObjectId; startAt: Date }>;
  now?: Date;
}): Promise<"confirmed" | "pending" | null> {
  if (input.appointments.length === 0) return null;
  const config = await getAppointmentConfirmationConfiguration();
  const firstStartAt = new Date(Math.min(...input.appointments.map((appointment) => appointment.startAt.getTime())));
  const attendance = confirmationStatusAfterPayment({ firstStartAt, now: input.now ?? new Date(), task: config });
  if (attendance === "confirmed") {
    await setAppointmentsConfirmation({
      appointmentIds: input.appointments.map((appointment) => appointment._id),
      customerId: input.customerId,
      from: ["pending", "missing"],
      to: "confirmed",
    });
  }
  return attendance;
}
