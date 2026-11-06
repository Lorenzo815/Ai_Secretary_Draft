import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPermissions, type Principal } from "../access/contracts";
import type { CalendarForwardingEndpoint } from "./forwarding-contracts";

function cursor<T>(rows: T[]) {
  const value = {
    sort: () => value, limit: () => value, toArray: async () => rows,
    async *[Symbol.asyncIterator]() { yield* rows; },
  };
  return value;
}

const mocks = vi.hoisted(() => {
  const collections: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const collection = (name: string) => (collections[name] ??= {
    find: vi.fn(), findOne: vi.fn(), replaceOne: vi.fn(), updateOne: vi.fn(), bulkWrite: vi.fn(),
    deleteMany: vi.fn(), insertOne: vi.fn(), createIndex: vi.fn(), aggregate: vi.fn(() => ({ toArray: async () => [] })),
  });
  const db = { collection };
  return {
    collections, collection, db,
    client: { db: () => db },
    adminTransaction: vi.fn(),
    operational: vi.fn(),
    cpf: vi.fn(),
    send: vi.fn(),
  };
});
vi.mock("../mongodb", () => ({ default: Promise.resolve(mocks.client), getMongoClient: async () => mocks.client }));
vi.mock("../access/management", async (importOriginal) => ({
  ...await importOriginal<typeof import("../access/management")>(), adminTransaction: mocks.adminTransaction,
}));
vi.mock("../companies/status", () => ({ isCompanyOperational: mocks.operational }));
vi.mock("../crm/customers", () => ({ revealCustomerCpf: mocks.cpf }));
vi.mock("../whatsapp/forwarding-http", async (importOriginal) => ({
  ...await importOriginal<typeof import("../whatsapp/forwarding-http")>(), sendForwardedWebhook: mocks.send,
}));

import {
  forwardDeletedAppointments, prepareCalendarDelivery, processCalendarForwarding, saveCalendarForwardingSettings,
  testCalendarForwardingEndpoint, validateCalendarForwardingEndpoints,
} from "./forwarding";
import type { Delivery } from "../forwarding/store";

const scope = new ObjectId("6ae8dee5cc807c3717ab1695");
const admin = new ObjectId();
const now = new Date("2026-11-06T13:00:00Z");
const principal: Principal = {
  id: admin.toHexString(), companyId: scope.toHexString(), companyName: "Clínica", name: "Admin",
  email: "admin@example.com", isAdmin: true, permissions: emptyPermissions(),
};
const endpoint: CalendarForwardingEndpoint = {
  id: "11111111-1111-4111-8111-111111111111", name: "CRM", url: "https://crm.example/hook", enabled: true, maxRetries: 3,
  triggers: ["created", "status_changed"], statuses: ["pending", "confirmed"], eventTypes: ["consultation"],
};
const customerId = new ObjectId("6abbbd640d62d8e984cae18c");
const appointment = (patch: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), companyId: scope, status: "scheduled", confirmationStatus: "pending", eventType: "consultation",
  providerId: "doctor", startAt: new Date("2026-11-10T13:00:00Z"), endAt: new Date("2026-11-10T13:30:00Z"),
  timezone: "America/Sao_Paulo", source: "manual", customerId, customerName: "Ana", contactPhone: "5511999990000",
  createdAt: new Date("2026-11-06T12:59:00Z"), updatedAt: new Date("2026-11-06T12:59:00Z"), ...patch,
});
const c = (name: string) => mocks.collection(name);
let configuration: Record<string, unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NEXTAUTH_URL", "https://oria.example");
  configuration = {
    _id: scope, companyId: scope, revision: 2, endpoints: [{ ...endpoint }],
    baselineAt: new Date("2026-11-06T12:00:00Z"), baselinePending: false, cursor: new Date("2026-11-06T12:58:00Z"),
  };
  for (const name of Object.keys(mocks.collections)) delete mocks.collections[name];
  c("calendar_forwarding_config").find.mockReturnValue(cursor([configuration]));
  c("calendar_forwarding_config").findOne.mockImplementation(async () => configuration);
  c("calendar_forwarding_config").updateOne.mockResolvedValue({ matchedCount: 1 });
  c("calendar_forwarding_states").find.mockReturnValue(cursor([]));
  c("calendar_appointments").find.mockReturnValue(cursor([]));
  c("calendar_settings").findOne.mockResolvedValue({ eventTypes: [{ key: "consultation", name: "Consulta" }, { key: "bio", name: "Bioimpedância" }], providerId: "doctor", providerName: "Dr. Matheus" });
  c("companies").findOne.mockResolvedValue({ _id: scope, name: "Clínica" });
  c("forwarding_stats").find.mockReturnValue(cursor([]));
  mocks.operational.mockResolvedValue(true);
  mocks.adminTransaction.mockImplementation(async (_principal, run) => run(mocks.db, {}, { _id: scope }));
  mocks.cpf.mockResolvedValue("12345678909");
  mocks.send.mockResolvedValue({ ok: true, status: 200, durationMs: 5, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const queued = () => c("whatsapp_forwarding_deliveries").bulkWrite.mock.calls.flatMap(([operations]) =>
  (operations as Array<{ updateOne: { update: { $setOnInsert: Delivery } } }>).map((operation) => operation.updateOne.update.$setOnInsert));

describe("calendar destination settings", () => {
  const types = new Set(["consultation", "bio"]);

  it("requires at least one moment, status and event type, and drops event types removed from the calendar", () => {
    expect(validateCalendarForwardingEndpoints([{ ...endpoint, eventTypes: ["consultation", "removed"] }], types)[0].eventTypes).toEqual(["consultation"]);
    for (const patch of [{ triggers: [] }, { statuses: [] }, { eventTypes: ["removed"] }, { triggers: ["deleted"] }, { statuses: ["held"] }, { companyId: "x" }]) {
      expect(() => validateCalendarForwardingEndpoints([{ ...endpoint, ...patch }], types)).toThrow();
    }
  });

  it("starts from a fresh baseline when the first destination is activated, and keeps it on later saves", async () => {
    configuration = { ...configuration, endpoints: [{ ...endpoint, enabled: false }], baselineAt: null, baselinePending: false, cursor: null };
    await saveCalendarForwardingSettings(principal, { revision: 2, endpoints: [endpoint] });
    expect(c("calendar_forwarding_config").replaceOne).toHaveBeenCalledWith({ _id: scope, companyId: scope }, expect.objectContaining({
      revision: 3, baselineAt: now, baselinePending: true, cursor: now, endpoints: [endpoint],
    }), expect.anything());

    configuration = { ...configuration, endpoints: [endpoint], baselineAt: new Date("2026-11-01T00:00:00Z"), baselinePending: false, cursor: new Date("2026-11-06T12:00:00Z") };
    await saveCalendarForwardingSettings(principal, { revision: 2, endpoints: [{ ...endpoint, name: "CRM 2" }] });
    expect(c("calendar_forwarding_config").replaceOne).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      baselineAt: new Date("2026-11-01T00:00:00Z"), baselinePending: false, cursor: new Date("2026-11-06T12:00:00Z"),
    }), expect.anything());
  });

  it("rejects stale saves and non-admins", async () => {
    await expect(saveCalendarForwardingSettings(principal, { revision: 1, endpoints: [endpoint] })).rejects.toMatchObject({ status: 409 });
    await expect(saveCalendarForwardingSettings({ ...principal, isAdmin: false }, { revision: 2, endpoints: [endpoint] })).rejects.toMatchObject({ status: 403 });
  });
});

describe("worker scan", () => {
  it("queues one delivery per matching destination for each change, records snapshots and advances the cursor", async () => {
    const created = appointment();
    const confirmed = appointment({ confirmationStatus: "confirmed", createdAt: new Date("2026-10-01T12:00:00Z") });
    const otherType = appointment({ eventType: "bio" });
    const hold = appointment({ status: "held" });
    c("calendar_appointments").find.mockReturnValue(cursor([created, confirmed, otherType, hold]));
    c("calendar_forwarding_states").find.mockReturnValue(cursor([
      { _id: confirmed._id, companyId: scope, status: "scheduled", confirmationStatus: "pending", startAt: confirmed.startAt },
    ]));
    configuration.endpoints = [endpoint, { ...endpoint, id: "22222222-2222-4222-8222-222222222222", url: "https://bi.example/hook", triggers: ["status_changed"], eventTypes: ["consultation", "bio"] }];

    expect(await processCalendarForwarding(now)).toEqual({ companies: 1, events: 3, queued: 3 });
    expect(c("calendar_appointments").find).toHaveBeenCalledWith({ companyId: scope, updatedAt: { $gte: new Date("2026-11-06T12:56:00Z") } });
    const deliveries = queued();
    expect(deliveries.map((delivery) => [delivery.endpointId.slice(0, 1), delivery.calendarEvent?.triggers])).toEqual([
      ["1", ["created"]], ["1", ["status_changed"]], ["2", ["status_changed"]],
    ]);
    expect(deliveries[0]).toMatchObject({ kind: "calendar", companyId: scope, status: "pending", isTest: false });
    expect(deliveries[0]).not.toHaveProperty("body");
    expect(deliveries[1].calendarEvent?.previous).toMatchObject({ confirmationStatus: "pending" });
    const states = c("calendar_forwarding_states").bulkWrite.mock.calls[0][0] as unknown[];
    expect(states).toHaveLength(3);
    expect(c("calendar_forwarding_config").updateOne).toHaveBeenLastCalledWith(
      { _id: scope, companyId: scope, baselineAt: configuration.baselineAt }, { $set: { cursor: now } },
    );
  });

  it("records the calendar as it was on activation instead of forwarding it", async () => {
    configuration.baselinePending = true;
    const existing = appointment({ createdAt: new Date("2026-10-01T12:00:00Z"), updatedAt: new Date("2026-10-01T12:00:00Z") });
    c("calendar_appointments").find.mockReturnValueOnce(cursor([existing])).mockReturnValueOnce(cursor([]));
    await processCalendarForwarding(now);
    expect(c("calendar_forwarding_states").deleteMany).toHaveBeenCalledWith({ companyId: scope });
    expect(c("calendar_appointments").find.mock.calls[0][0]).toMatchObject({ companyId: scope, status: "scheduled", updatedAt: { $lt: configuration.baselineAt } });
    expect(c("calendar_forwarding_states").bulkWrite).toHaveBeenCalledTimes(1);
    expect(c("calendar_forwarding_config").updateOne).toHaveBeenCalledWith(
      { _id: scope, companyId: scope, revision: 2 }, { $set: { baselinePending: false, baselineAt: configuration.baselineAt, cursor: configuration.baselineAt } },
    );
    expect(queued()).toEqual([]);
  });

  it("skips clinics that are not operational and keeps scanning the others after a failure", async () => {
    const other = { ...configuration, _id: new ObjectId(), companyId: new ObjectId() };
    c("calendar_forwarding_config").find.mockReturnValue(cursor([configuration, other]));
    mocks.operational.mockImplementation(async (id: ObjectId) => id.equals(scope));
    c("calendar_appointments").find.mockImplementation(() => { throw new Error("boom"); });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await processCalendarForwarding(now)).toEqual({ companies: 0, events: 0, queued: 0 });
    expect(errors).toHaveBeenCalledOnce();
  });
});

describe("deleted appointments", () => {
  it("forwards a booking removed from the calendar as cancelled and forgets it", async () => {
    const removed = appointment({ confirmationStatus: "confirmed" });
    c("calendar_forwarding_states").find.mockReturnValue(cursor([
      { _id: removed._id, companyId: scope, status: "scheduled", confirmationStatus: "confirmed", startAt: removed.startAt },
    ]));
    configuration.endpoints = [{ ...endpoint, triggers: ["cancelled"], statuses: ["confirmed"] }];
    expect(await forwardDeletedAppointments([removed as never])).toBe(1);
    expect(queued()[0].calendarEvent).toMatchObject({ triggers: ["cancelled"], deleted: true });
    expect(c("calendar_forwarding_states").deleteMany).toHaveBeenCalledWith({ companyId: scope, _id: { $in: [removed._id] } });
  });

  it("never breaks the deletion", async () => {
    c("calendar_forwarding_config").findOne.mockRejectedValue(new Error("down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(forwardDeletedAppointments([appointment() as never])).resolves.toBe(0);
    expect(errors).toHaveBeenCalledOnce();
  });
});

describe("sending", () => {
  const delivery = (patch: Partial<Delivery> = {}): Delivery => ({
    _id: new ObjectId(), companyId: scope, kind: "calendar", endpointId: endpoint.id, endpointName: endpoint.name, url: endpoint.url,
    digest: "d", status: "processing", attempts: 1, maxRetries: 3, dueAt: now, createdAt: now, updatedAt: now, isTest: false,
    calendarEvent: {
      eventId: "d", triggers: ["created"], occurredAt: now, deleted: false, previous: null,
      appointment: appointment() as never,
    },
    ...patch,
  });

  it("builds the payload when sending, with the current CRM profile and the decrypted CPF", async () => {
    c("crm_customers").findOne.mockResolvedValue({ _id: customerId, name: "Ana", phones: ["5511999990000"], profile: { fullName: "Ana Souza" } });
    const body = await prepareCalendarDelivery(mocks.db as never, delivery());
    const payload = JSON.parse(Buffer.from(body!).toString("utf8"));
    expect(c("crm_customers").findOne).toHaveBeenCalledWith({ _id: customerId, companyId: scope }, expect.anything());
    expect(mocks.cpf).toHaveBeenCalledWith(customerId);
    expect(payload).toMatchObject({
      company: { id: scope.toHexString(), name: "Clínica" },
      appointment: { eventType: { key: "consultation", name: "Consulta" }, resource: { name: "Dr. Matheus" } },
      customer: { fullName: "Ana Souza", cpf: "12345678909" },
    });
  });

  it.each([
    ["removed", []],
    ["disabled", [{ ...endpoint, enabled: false }]],
    ["moved to another URL", [{ ...endpoint, url: "https://other.example/hook" }]],
    ["no longer listening to the event type", [{ ...endpoint, eventTypes: ["bio"] }]],
  ])("cancels a queued event when the destination was %s", async (_label, endpoints) => {
    configuration.endpoints = endpoints;
    expect(await prepareCalendarDelivery(mocks.db as never, delivery())).toBeNull();
    expect(mocks.cpf).not.toHaveBeenCalled();
  });

  it("tests a saved destination with a fake patient, once, with the calendar event header", async () => {
    let inserted: Delivery | null = null;
    c("whatsapp_forwarding_deliveries").insertOne.mockImplementation(async (document: Delivery) => { inserted = document; });
    c("whatsapp_forwarding_deliveries").findOne.mockImplementation(async (filter: { _id?: ObjectId }) => filter._id ? inserted : null);
    const result = await testCalendarForwardingEndpoint(principal, endpoint.id);
    expect(result.result).toMatchObject({ ok: true });
    const sent = mocks.send.mock.calls[0][0];
    expect(sent).toMatchObject({ url: endpoint.url, isTest: true, event: "calendar.appointment" });
    const payload = JSON.parse(Buffer.from(sent.body).toString("utf8"));
    expect(payload).toMatchObject({ test: true, customer: { cpf: "00000000000", name: "Paciente de teste" } });
    expect(mocks.cpf).not.toHaveBeenCalled();
  });
});
