import "server-only";

import { randomUUID } from "node:crypto";
import { Binary, ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import { adminTransaction, ManagementError } from "../access/management";
import type { Principal } from "../access/contracts";
import { companyScopedId } from "../companies/ownership";
import { isCompanyOperational } from "../companies/status";
import { sendForwardedWebhook } from "../whatsapp/forwarding-http";
import type { ForwardingResult } from "../whatsapp/forwarding-contracts";
import {
  adminCompanyId, assertTestAllowed, deliveryCollection, ensureDeliveryIndexes, finishDelivery, forwardingDatabase,
  LEASE_MS, readForwardingStats, requireAdminCompany, validateEndpointList, type Delivery,
} from "../forwarding/store";
import {
  CALENDAR_FORWARDING_STATUSES, CALENDAR_FORWARDING_TRIGGERS,
  type CalendarForwardingEndpoint, type CalendarForwardingSettings,
} from "./forwarding-contracts";
import {
  buildCalendarPayload, calendarDeliveryEvent, detectCalendarTriggers, endpointAccepts, sameSnapshot, snapshotOf,
  type CalendarDeliveryEvent, type ForwardedAppointment, type ForwardedCustomer, type ForwardingSnapshot,
} from "./forwarding-events";

interface Configuration {
  _id: ObjectId;
  companyId: ObjectId;
  revision: number;
  endpoints: CalendarForwardingEndpoint[];
  /** When forwarding was (re)activated: what existed before is the starting point, not a change. */
  baselineAt: Date | null;
  /** The worker still has to record the calendar as it was at `baselineAt`. */
  baselinePending: boolean;
  /** Appointments changed after this (minus a safety overlap) are compared on the next scan. */
  cursor: Date | null;
  updatedAt: Date;
  updatedBy: ObjectId;
}

interface StateDocument extends ForwardingSnapshot {
  _id: ObjectId;
  companyId: ObjectId;
  expiresAt: Date;
}

interface CalendarSettingsView {
  providerId?: string;
  providerName?: string;
  eventTypes?: Array<{ key: string; name: string }>;
  resources?: Array<{ id: string; name: string }>;
}

type AppointmentRecord = ForwardedAppointment & { companyId: ObjectId };

const configurationCollection = (db: Db) => db.collection<Configuration>("calendar_forwarding_config");
const stateCollection = (db: Db) => db.collection<StateDocument>("calendar_forwarding_states");
const appointmentCollection = (db: Db) => db.collection<AppointmentRecord>("calendar_appointments");

const DAY_MS = 24 * 60 * 60_000;
// Transactions commit after computing `updatedAt`, so a scan rereads the last minutes; snapshots make it idempotent.
const OVERLAP_MS = 2 * 60_000;
const BASELINE_PAST_MS = 7 * DAY_MS;
const STATE_RETENTION_MS = 30 * DAY_MS;
const SCAN_LIMIT = 5_000;
const EVENT_HEADER = "calendar.appointment";

let indexes: Promise<unknown> | undefined;
async function ensureIndexes(db: Db) {
  if (!indexes) {
    indexes = Promise.all([
      appointmentCollection(db).createIndex({ companyId: 1, updatedAt: 1 }),
      stateCollection(db).createIndex({ companyId: 1 }),
      stateCollection(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ensureDeliveryIndexes(db),
    ]);
    void indexes.catch(() => { indexes = undefined; });
  }
  await indexes;
}

async function loadCalendarSettings(db: Db, companyId: ObjectId): Promise<Required<Pick<CalendarSettingsView, "eventTypes">> & CalendarSettingsView> {
  const settings = await db.collection<CalendarSettingsView & { _id: string }>("calendar_settings").findOne(
    { _id: companyScopedId(companyId, "default-calendar"), companyId },
    { projection: { providerId: 1, providerName: 1, eventTypes: 1, resources: 1 } },
  );
  return { ...settings, eventTypes: settings?.eventTypes ?? [] };
}

function resourceNames(settings: CalendarSettingsView) {
  const resources = (settings.resources ?? []).map(({ id, name }) => ({ id, name }));
  if (settings.providerId && settings.providerName && !resources.some((resource) => resource.id === settings.providerId)) {
    resources.push({ id: settings.providerId, name: settings.providerName });
  }
  return resources;
}

// --- Settings -----------------------------------------------------------------------------------------------------

export async function getCalendarForwardingSettings(principal: Principal): Promise<CalendarForwardingSettings> {
  const db = await forwardingDatabase();
  const { scope } = await requireAdminCompany(db, principal);
  const [configuration, settings, stats] = await Promise.all([
    configurationCollection(db).findOne({ _id: scope, companyId: scope }),
    loadCalendarSettings(db, scope),
    readForwardingStats(db, scope, "calendar"),
  ]);
  return {
    revision: configuration?.revision ?? 0,
    endpoints: configuration?.endpoints ?? [],
    eventTypes: settings.eventTypes.map(({ key, name }) => ({ key, name })),
    stats,
  };
}

function subset<T extends string>(value: unknown, allowed: readonly T[], message: string): T[] {
  if (!Array.isArray(value) || value.some((item) => !allowed.includes(item as T))) throw new ManagementError(message);
  const chosen = allowed.filter((item) => value.includes(item));
  if (chosen.length === 0) throw new ManagementError(message);
  return chosen;
}

/** Every destination listens to at least one moment, one confirmation status and one of the clinic's event types. */
export function validateCalendarForwardingEndpoints(value: unknown, eventTypeKeys: ReadonlySet<string>): CalendarForwardingEndpoint[] {
  return validateEndpointList(value, ["triggers", "statuses", "eventTypes"], (endpoint, base) => {
    const triggers = subset(endpoint.triggers, CALENDAR_FORWARDING_TRIGGERS, `“${base.name}”: escolha ao menos um momento de envio.`);
    const statuses = subset(endpoint.statuses, CALENDAR_FORWARDING_STATUSES, `“${base.name}”: escolha ao menos um status de confirmação.`);
    if (!Array.isArray(endpoint.eventTypes) || endpoint.eventTypes.length > 200 || endpoint.eventTypes.some((key) => typeof key !== "string")) {
      throw new ManagementError(`“${base.name}”: tipos de evento inválidos.`);
    }
    // Event types removed from the calendar since the last save are dropped silently.
    const eventTypes = [...new Set(endpoint.eventTypes as string[])].filter((key) => eventTypeKeys.has(key));
    if (eventTypes.length === 0) throw new ManagementError(`“${base.name}”: escolha ao menos um tipo de evento da agenda.`);
    return { ...base, triggers, statuses, eventTypes };
  });
}

export async function saveCalendarForwardingSettings(principal: Principal, input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => !["revision", "endpoints"].includes(key)) ||
    !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new ManagementError("Configuração inválida.");
  const scope = adminCompanyId(principal);
  const settings = await loadCalendarSettings(await forwardingDatabase(), scope);
  const endpoints = validateCalendarForwardingEndpoints(input.endpoints, new Set(settings.eventTypes.map((eventType) => eventType.key)));
  await adminTransaction(principal, async (db, session) => {
    const collection = configurationCollection(db);
    const current = await collection.findOne({ _id: scope, companyId: scope }, { session });
    if ((current?.revision ?? 0) !== input.revision) throw new ManagementError("A configuração mudou. Recarregue antes de salvar.", 409);
    const now = new Date();
    const activating = endpoints.some((endpoint) => endpoint.enabled) && !current?.endpoints.some((endpoint) => endpoint.enabled);
    await collection.replaceOne({ _id: scope, companyId: scope }, {
      companyId: scope, revision: Number(input.revision) + 1, endpoints,
      baselineAt: activating ? now : current?.baselineAt ?? null,
      baselinePending: activating ? true : current?.baselinePending ?? false,
      cursor: activating ? now : current?.cursor ?? null,
      updatedAt: now, updatedBy: new ObjectId(principal.id),
    }, { upsert: !current, session });
  });
  return getCalendarForwardingSettings(principal);
}

// --- Detecting changes --------------------------------------------------------------------------------------------

async function enqueueEvents(db: Db, configuration: Configuration, events: CalendarDeliveryEvent[]) {
  const now = new Date();
  const operations: AnyBulkWriteOperation<Delivery>[] = [];
  for (const event of events) {
    for (const endpoint of configuration.endpoints) {
      if (!endpointAccepts(endpoint, event)) continue;
      operations.push({
        updateOne: {
          filter: { companyId: configuration.companyId, endpointId: endpoint.id, digest: event.eventId },
          update: { $setOnInsert: {
            _id: new ObjectId(), companyId: configuration.companyId, kind: "calendar", endpointId: endpoint.id,
            endpointName: endpoint.name, url: endpoint.url, digest: event.eventId, calendarEvent: event, isTest: false,
            status: "pending", attempts: 0, maxRetries: endpoint.maxRetries, dueAt: now, createdAt: now, updatedAt: now,
          } },
          upsert: true,
        },
      });
    }
  }
  if (operations.length === 0) return 0;
  await ensureDeliveryIndexes(db);
  await deliveryCollection(db).bulkWrite(operations, { ordered: false });
  return operations.length;
}

function stateWrite(scope: ObjectId, appointment: ForwardedAppointment): AnyBulkWriteOperation<StateDocument> {
  return {
    updateOne: {
      filter: { _id: appointment._id, companyId: scope },
      update: { $set: { ...snapshotOf(appointment), companyId: scope, expiresAt: new Date(appointment.startAt.getTime() + STATE_RETENTION_MS) } },
      upsert: true,
    },
  };
}

/** Records the calendar as it is now, so only what changes afterwards is forwarded. */
async function takeBaseline(db: Db, scope: ObjectId, baselineAt: Date) {
  await stateCollection(db).deleteMany({ companyId: scope });
  const cursor = appointmentCollection(db).find(
    { companyId: scope, status: "scheduled", startAt: { $gte: new Date(baselineAt.getTime() - BASELINE_PAST_MS) }, updatedAt: { $lt: baselineAt } },
    { projection: { status: 1, confirmationStatus: 1, startAt: 1 } },
  );
  let batch: AnyBulkWriteOperation<StateDocument>[] = [];
  for await (const appointment of cursor) {
    batch.push(stateWrite(scope, appointment));
    if (batch.length === 500) {
      await stateCollection(db).bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }
  if (batch.length) await stateCollection(db).bulkWrite(batch, { ordered: false });
}

async function scanCompany(db: Db, configuration: Configuration, now: Date) {
  const scope = configuration.companyId;
  let { baselineAt, cursor } = configuration;
  if (configuration.baselinePending || !baselineAt || !cursor) {
    baselineAt = baselineAt ?? now;
    await takeBaseline(db, scope, baselineAt);
    const done = await configurationCollection(db).updateOne(
      { _id: scope, companyId: scope, revision: configuration.revision },
      { $set: { baselinePending: false, baselineAt, cursor: baselineAt } },
    );
    if (done.matchedCount === 0) return { events: 0, queued: 0 };
    cursor = baselineAt;
  }

  const appointments = await appointmentCollection(db).find({
    companyId: scope, updatedAt: { $gte: new Date(cursor.getTime() - OVERLAP_MS) },
  }).sort({ updatedAt: 1 }).limit(SCAN_LIMIT).toArray();
  const nextCursor = appointments.length === SCAN_LIMIT ? appointments[appointments.length - 1].updatedAt : now;
  const events: CalendarDeliveryEvent[] = [];
  let queued = 0;
  if (appointments.length > 0) {
    const states = new Map((await stateCollection(db).find({
      companyId: scope, _id: { $in: appointments.map((appointment) => appointment._id) },
    }).toArray()).map((state) => [state._id.toHexString(), state]));
    const writes: AnyBulkWriteOperation<StateDocument>[] = [];
    for (const appointment of appointments) {
      if (appointment.status === "held") continue;
      const state = states.get(appointment._id.toHexString());
      const previous: ForwardingSnapshot | null = state
        ? { status: state.status, confirmationStatus: state.confirmationStatus, startAt: state.startAt }
        : null;
      const triggers = detectCalendarTriggers(appointment, previous, { baselineAt, now });
      if (triggers.length > 0) events.push(calendarDeliveryEvent(appointment, triggers, previous));
      if (!previous || !sameSnapshot(previous, snapshotOf(appointment))) writes.push(stateWrite(scope, appointment));
    }
    // Deliveries first: if saving the snapshots fails, the next scan finds the same changes and the same event IDs.
    queued = await enqueueEvents(db, configuration, events);
    if (writes.length) await stateCollection(db).bulkWrite(writes, { ordered: false });
  }
  await configurationCollection(db).updateOne(
    { _id: scope, companyId: scope, baselineAt },
    { $set: { cursor: nextCursor } },
  );
  return { events: events.length, queued };
}

/** Worker step: compares recently changed appointments of every clinic with active calendar destinations. */
export async function processCalendarForwarding(now = new Date()) {
  const db = await forwardingDatabase();
  const configurations = await configurationCollection(db).find({ "endpoints.enabled": true }).toArray();
  const totals = { companies: 0, events: 0, queued: 0 };
  if (configurations.length === 0) return totals;
  await ensureIndexes(db);
  for (const configuration of configurations) {
    if (!(await isCompanyOperational(configuration.companyId))) continue;
    try {
      const result = await scanCompany(db, configuration, now);
      totals.companies += 1;
      totals.events += result.events;
      totals.queued += result.queued;
    } catch (error) {
      console.error("Calendar forwarding scan failed.", {
        company: configuration.companyId.toHexString(), errorType: error instanceof Error ? error.name : "Unknown",
      });
    }
  }
  return totals;
}

/**
 * Appointments removed from the database leave nothing to scan: the calendar calls this right after deleting them.
 * Never throws, so forwarding can't break a deletion.
 */
export async function forwardDeletedAppointments(appointments: Array<ForwardedAppointment & { companyId?: ObjectId }>) {
  try {
    const byCompany = new Map<string, Array<ForwardedAppointment & { companyId: ObjectId }>>();
    for (const appointment of appointments) {
      if (!(appointment.companyId instanceof ObjectId)) continue;
      const key = appointment.companyId.toHexString();
      byCompany.set(key, [...(byCompany.get(key) ?? []), appointment as ForwardedAppointment & { companyId: ObjectId }]);
    }
    if (byCompany.size === 0) return 0;
    const db = await forwardingDatabase();
    let queued = 0;
    for (const group of byCompany.values()) {
      const scope = group[0].companyId;
      const configuration = await configurationCollection(db).findOne({ _id: scope, companyId: scope, "endpoints.enabled": true });
      if (!configuration || configuration.baselinePending) continue;
      const ids = group.map((appointment) => appointment._id);
      const states = new Map((await stateCollection(db).find({ companyId: scope, _id: { $in: ids } }).toArray())
        .map((state) => [state._id.toHexString(), state]));
      const now = new Date();
      const events = group.flatMap((appointment) => {
        const state = states.get(appointment._id.toHexString());
        if (state?.status !== "scheduled") return [];
        const previous = { status: state.status, confirmationStatus: state.confirmationStatus, startAt: state.startAt };
        return [calendarDeliveryEvent(appointment, ["cancelled"], previous, { deleted: true, occurredAt: now })];
      });
      queued += await enqueueEvents(db, configuration, events);
      await stateCollection(db).deleteMany({ companyId: scope, _id: { $in: ids } });
    }
    return queued;
  } catch (error) {
    console.error("Calendar forwarding of deleted appointments failed.", { errorType: error instanceof Error ? error.name : "Unknown" });
    return 0;
  }
}

// --- Sending ------------------------------------------------------------------------------------------------------

async function loadCustomer(db: Db, companyId: ObjectId, customerId: ObjectId | null | undefined): Promise<ForwardedCustomer | null> {
  if (!(customerId instanceof ObjectId)) return null;
  // The projection never reads the CPF, so it can't reach a destination.
  return db.collection<ForwardedCustomer>("crm_customers").findOne(
    { _id: customerId, companyId },
    { projection: { name: 1, phones: 1, "profile.fullName": 1, "profile.birthDate": 1, "profile.address": 1, "profile.profession": 1, relationship: 1, serviceStatus: 1, firstInteractionAt: 1, lastInteractionAt: 1, createdAt: 1 } },
  );
}

/**
 * The bytes to send for a queued calendar delivery, or null to cancel it: the destination was removed, edited,
 * disabled, or no longer listens to this event. The patient's data is read now, so it is never stored in the queue.
 */
export async function prepareCalendarDelivery(db: Db, delivery: Delivery): Promise<Uint8Array | null> {
  const event = delivery.calendarEvent;
  if (!event) return null;
  const configuration = await configurationCollection(db).findOne({ _id: delivery.companyId, companyId: delivery.companyId });
  const endpoint = configuration?.endpoints.find((item) => item.id === delivery.endpointId && item.url === delivery.url);
  if (!endpoint || !endpointAccepts(endpoint, event)) return null;
  const [company, settings, customer] = await Promise.all([
    db.collection<{ _id: ObjectId; name?: string }>("companies").findOne({ _id: delivery.companyId }, { projection: { name: 1 } }),
    loadCalendarSettings(db, delivery.companyId),
    loadCustomer(db, delivery.companyId, event.appointment.customerId),
  ]);
  const payload = buildCalendarPayload(event, {
    company: { id: delivery.companyId.toHexString(), name: company?.name ?? "" },
    eventTypes: settings.eventTypes,
    resources: resourceNames(settings),
    customer,
  });
  return new Uint8Array(Buffer.from(JSON.stringify(payload)));
}

export async function sendCalendarDelivery(delivery: Delivery, body: Uint8Array) {
  return sendForwardedWebhook({
    url: delivery.url, body, deliveryId: delivery._id.toHexString(), isTest: delivery.isTest, event: EVENT_HEADER,
  });
}

function samplePayload(principal: Principal, endpoint: CalendarForwardingEndpoint, settings: CalendarSettingsView & { eventTypes: Array<{ key: string; name: string }> }) {
  const now = new Date();
  const startAt = new Date(Math.ceil((now.getTime() + DAY_MS) / 3_600_000) * 3_600_000);
  const eventType = settings.eventTypes.find((item) => endpoint.eventTypes.includes(item.key)) ?? settings.eventTypes[0] ?? { key: "consultation", name: "Consulta" };
  const appointment: ForwardedAppointment = {
    _id: new ObjectId(), status: "scheduled", confirmationStatus: endpoint.statuses[0] ?? "pending",
    eventType: eventType.key, providerId: settings.providerId ?? "doctor", startAt, endAt: new Date(startAt.getTime() + 30 * 60_000),
    timezone: "America/Sao_Paulo", durationMinutes: 30, source: "manual", customerId: new ObjectId(),
    customerName: "Paciente de teste", contactPhone: "5511900000000", createdAt: now, updatedAt: now,
  };
  const event = calendarDeliveryEvent(appointment, [endpoint.triggers[0] ?? "created"], null, { occurredAt: now });
  return buildCalendarPayload(event, {
    company: { id: principal.companyId, name: principal.companyName },
    eventTypes: settings.eventTypes,
    resources: resourceNames(settings),
    customer: {
      _id: appointment.customerId!, name: "Paciente de teste", phones: ["5511900000000"],
      profile: { fullName: "Paciente de Teste da Silva", birthDate: "1990-01-01", profession: "Teste" },
      relationship: { status: "new" }, serviceStatus: "ai_active",
      firstInteractionAt: now, lastInteractionAt: now, createdAt: now,
    },
    test: true,
  });
}

/** Sends a synthetic event (fake patient) to a saved destination, once, and returns the result. */
export async function testCalendarForwardingEndpoint(principal: Principal, endpointId: unknown) {
  if (typeof endpointId !== "string") throw new ManagementError("Selecione um destino salvo.");
  const scope = adminCompanyId(principal);
  const id = new ObjectId();
  const settings = await loadCalendarSettings(await forwardingDatabase(), scope);
  await ensureDeliveryIndexes(await forwardingDatabase());
  await adminTransaction(principal, async (db, session) => {
    const configuration = await configurationCollection(db).findOne({ _id: scope, companyId: scope }, { session });
    const endpoint = configuration?.endpoints.find((item) => item.id === endpointId);
    if (!endpoint) throw new ManagementError("Salve o destino antes de testar.", 409);
    await assertTestAllowed(db, scope, session);
    const now = new Date();
    await deliveryCollection(db).insertOne({
      _id: id, companyId: scope, kind: "calendar", endpointId, endpointName: endpoint.name, url: endpoint.url,
      digest: id.toHexString(), body: new Binary(Buffer.from(JSON.stringify(samplePayload(principal, endpoint, settings)))),
      isTest: true, status: "processing", attempts: 1, maxRetries: 0, dueAt: now, createdAt: now, updatedAt: now,
      leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS),
    }, { session });
  });
  const db = await forwardingDatabase();
  const delivery = await deliveryCollection(db).findOne({ _id: id, companyId: scope });
  if (!delivery?.body) throw new ManagementError("O teste não foi encontrado.", 500);
  const result: ForwardingResult = await sendCalendarDelivery(delivery, delivery.body.value());
  await finishDelivery(db, delivery, result);
  return { result, settings: await getCalendarForwardingSettings(principal) };
}
