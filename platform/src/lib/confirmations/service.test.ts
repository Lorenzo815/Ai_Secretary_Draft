import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory collection: enough query operators for the confirmation service.
type Doc = Record<string, unknown> & { _id: ObjectId };
function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return (condition as Record<string, unknown>[]).some((option) => matches(doc, option));
    const value = doc[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date) && !(condition instanceof ObjectId)) {
      return Object.entries(condition).every(([operator, operand]) => {
        if (operator === "$in") return (operand as unknown[]).some((item) => same(value, item));
        if (operator === "$exists") return (value !== undefined) === operand;
        if (operator === "$lte") return value != null && (value as Date) <= (operand as Date);
        if (operator === "$gt") return value != null && (value as Date) > (operand as Date);
        throw new Error(`operator ${operator}`);
      });
    }
    return same(value ?? null, condition);
  });
}
function same(left: unknown, right: unknown) {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}
function apply(doc: Doc, update: { $set?: object; $unset?: object }) {
  Object.assign(doc, update.$set ?? {});
  for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
}
const store: Doc[] = [];
const collection = {
  createIndex: vi.fn(),
  find: (filter: Record<string, unknown>) => ({ toArray: async () => store.filter((doc) => matches(doc, filter)), limit: () => ({ toArray: async () => store.filter((doc) => matches(doc, filter)) }) }),
  findOne: async (filter: Record<string, unknown>) => store.find((doc) => matches(doc, filter)) ?? null,
  updateOne: async (filter: Record<string, unknown>, update: { $set?: object; $unset?: object; $setOnInsert?: Doc }, options?: { upsert?: boolean }) => {
    const doc = store.find((item) => matches(item, filter));
    if (doc) { apply(doc, update); return { matchedCount: 1, upsertedCount: 0 }; }
    if (options?.upsert && update.$setOnInsert) { store.push({ ...update.$setOnInsert }); return { matchedCount: 0, upsertedCount: 1 }; }
    return { matchedCount: 0, upsertedCount: 0 };
  },
  findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set?: object }) => {
    const doc = store.find((item) => matches(item, filter));
    if (!doc) return null;
    apply(doc, update);
    return doc;
  },
};

const mocks = vi.hoisted(() => ({
  appointments: [] as Array<Record<string, unknown>>,
  config: {} as Record<string, unknown>,
  setAppointmentsConfirmation: vi.fn(async () => 1),
  sendWhatsAppTemplate: vi.fn(async () => ({ messageId: "wamid.template", to: "5511999990000" })),
  sendTextMessage: vi.fn(async () => ({ messageId: "wamid.text" })),
  saveWhatsAppMessage: vi.fn(),
  updateCustomerServiceStatus: vi.fn(),
  templateState: "approved",
}));

vi.mock("../companies/tenant-db", () => ({ tenantDb: async () => ({ collection: () => collection }) }));
vi.mock("../companies/context", () => ({
  runWithCompany: (_id: unknown, operation: () => unknown) => operation(),
  withCurrentCompany: async (document: object) => ({ ...document }),
}));
vi.mock("../companies/status", () => ({ isCompanyOperational: async () => true }));
vi.mock("../calendar", () => ({
  getCalendarSettings: async () => ({ timezone: "America/Sao_Paulo", eventTypes: [{ key: "consultation", name: "Consulta" }, { key: "bio", name: "Bioimpedância" }] }),
  listAppointmentsAwaitingConfirmation: async ({ from, to }: { from: Date; to: Date }) => mocks.appointments
    .filter((appointment) => (appointment.startAt as Date) > from && (appointment.startAt as Date) <= to)
    .sort((first, second) => (first.startAt as Date).getTime() - (second.startAt as Date).getTime()),
  findAppointmentsByIds: async (ids: ObjectId[]) => mocks.appointments.filter((appointment) => ids.some((id) => id.equals(appointment._id as ObjectId))),
  setAppointmentsConfirmation: mocks.setAppointmentsConfirmation,
}));
vi.mock("../crm", () => ({
  findCustomerById: async () => ({ _id: customerId, name: "Ana Souza", phones: ["5511999990000"] }),
  updateCustomerServiceStatus: mocks.updateCustomerServiceStatus,
}));
vi.mock("../whatsapp/client", () => ({ sendWhatsAppTemplate: mocks.sendWhatsAppTemplate, sendTextMessage: mocks.sendTextMessage }));
vi.mock("../whatsapp/messages", () => ({ saveWhatsAppMessage: mocks.saveWhatsAppMessage }));
vi.mock("./config", () => ({
  getAppointmentConfirmationConfiguration: async () => mocks.config,
  listConfirmationEnabledCompanyIds: async () => [new ObjectId()],
}));
vi.mock("./template", () => ({ getConfirmationTemplateStatus: async () => ({ state: mocks.templateState, body: null, message: "" }) }));

const customerId = new ObjectId();

import { applyAttendanceAfterPayment, handleConfirmationButton, processAppointmentConfirmations } from "./service";
import { confirmationPayload } from "./template-content";

const hours = (count: number) => count * 3_600_000;
// Friday 06/11 10:00 and 10:30 in São Paulo (UTC-3).
const event = (patch: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), customerId, status: "scheduled", confirmationStatus: "pending", eventType: "consultation",
  startAt: new Date("2026-11-06T13:00:00Z"), createdAt: new Date("2026-11-01T12:00:00Z"), timezone: "America/Sao_Paulo", ...patch,
});
// The worker runs the task at most once a minute: steps in a test are at least a minute apart.
const tick = (iso: string) => processAppointmentConfirmations(new Date(iso));

describe("appointment confirmation reminders", () => {
  beforeEach(() => {
    store.length = 0;
    vi.clearAllMocks();
    mocks.templateState = "approved";
    mocks.config = {
      enabled: true, firstSendHoursBefore: 24, activeStartHour: 8, activeEndHour: 20, maxAttempts: 3,
      intervalMinutes: 120, skipRecentHours: 12, template: { name: "oria_confirmacao_consulta", language: "pt_BR", body: "Olá, {{1}}! {{2}}: {{3}}." },
    };
    mocks.appointments = [event(), event({ eventType: "bio", startAt: new Date("2026-11-06T13:30:00Z") })];
  });

  it("sends one message per patient and day with the day's events and the three buttons, then retries 2 h apart", async () => {
    await tick("2026-11-05T12:59:00Z"); // Thu 09:59: before 24 h
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();

    await tick("2026-11-05T13:00:00Z"); // Thu 10:00
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce();
    const sent = (mocks.sendWhatsAppTemplate.mock.calls as unknown as Array<[unknown]>)[0][0] as { bodyParameters: string[]; quickReplyPayloads: Array<{ index: number; payload: string }> };
    expect(sent.bodyParameters).toEqual(["Ana", "sexta-feira, 06/11", "10:00 Consulta; 10:30 Bioimpedância"]);
    const cycleId = store[0]._id.toHexString();
    expect(sent.quickReplyPayloads).toEqual([
      { index: 0, payload: confirmationPayload(cycleId, "confirm") },
      { index: 1, payload: confirmationPayload(cycleId, "reschedule") },
      { index: 2, payload: confirmationPayload(cycleId, "cancel") },
    ]);
    expect(mocks.saveWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({ direction: "outbound", type: "template", body: expect.stringContaining("Olá, Ana!") }));

    await tick("2026-11-05T14:00:00Z");
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce();
    await tick("2026-11-05T15:00:00Z"); // 12:00
    await tick("2026-11-05T17:00:00Z"); // 14:00
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledTimes(3);
    expect(store[0]).toMatchObject({ nextAttemptAt: null, deadlineAt: new Date("2026-11-05T19:00:00Z") });
  });

  it("ignores staff bookings without a patient instead of failing the whole clinic", async () => {
    mocks.appointments = [event({ customerId: null, startAt: new Date("2026-11-06T12:00:00Z") }), ...mocks.appointments];

    await expect(tick("2026-11-05T13:01:00Z")).resolves.toMatchObject({ companies: 1, planned: 1, sent: 1 });
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce();
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ customerId, appointmentIds: [mocks.appointments[1]._id, mocks.appointments[2]._id] });
  });

  it("marks the events \"Sem confirmação\" one interval after the last reminder", async () => {
    await tick("2026-11-05T13:00:00Z");
    await tick("2026-11-05T15:00:00Z");
    await tick("2026-11-05T17:00:00Z");
    await tick("2026-11-05T18:59:00Z");
    expect(mocks.setAppointmentsConfirmation).not.toHaveBeenCalled();

    await tick("2026-11-05T19:00:00Z");
    expect(mocks.setAppointmentsConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      appointmentIds: mocks.appointments.map((appointment) => appointment._id), to: "unconfirmed", from: ["pending", "missing"],
    }));
    expect(store[0].status).toBe("unconfirmed");
  });

  it("skips bookings made shortly before the first reminder, unless a deposit was paid", async () => {
    mocks.appointments = [event({ createdAt: new Date("2026-11-05T12:00:00Z") })];
    await tick("2026-11-05T13:00:00Z");
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();

    mocks.appointments = [event({ createdAt: new Date("2026-11-05T12:00:00Z"), paymentRequestId: new ObjectId() })];
    await tick("2026-11-05T13:02:00Z");
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledOnce();
  });

  it("doesn't send while the template isn't approved", async () => {
    mocks.templateState = "pending";
    await tick("2026-11-05T13:00:00Z");
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  describe("button replies", () => {
    let minute = 10;
    async function cycleId() {
      minute += 2;
      await tick(`2026-11-05T13:${String(minute).padStart(2, "0")}:00Z`);
      return store[0]._id.toHexString();
    }
    const customer = { _id: customerId, name: "Ana Souza", phones: ["5511999990000"] };

    it("confirms the day's events without the AI", async () => {
      const id = await cycleId();
      await expect(handleConfirmationButton({ customer, payload: confirmationPayload(id, "confirm") })).resolves.toEqual({ handled: true, runAgent: false });
      expect(mocks.setAppointmentsConfirmation).toHaveBeenCalledWith(expect.objectContaining({ to: "confirmed" }));
      expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Presença confirmada") }));
      expect(store[0]).toMatchObject({ status: "confirmed", nextAttemptAt: null });
    });

    it("hands \"Escolher novo horário\" to the AI, also from human service, and stops reminders", async () => {
      const id = await cycleId();
      await expect(handleConfirmationButton({ customer, payload: confirmationPayload(id, "reschedule") })).resolves.toEqual({ handled: true, runAgent: true });
      expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "ai_active");
      expect(mocks.setAppointmentsConfirmation).not.toHaveBeenCalled();
      expect(store[0]).toMatchObject({ status: "reschedule_requested", nextAttemptAt: null });
    });

    it("never cancels: a cancellation request goes to the staff", async () => {
      const id = await cycleId();
      await handleConfirmationButton({ customer, payload: confirmationPayload(id, "cancel") });
      expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "waiting_human");
      expect(mocks.setAppointmentsConfirmation).not.toHaveBeenCalled();
      expect(store[0].status).toBe("cancel_requested");
    });

    it("leaves late answers (after \"Sem confirmação\") to the staff", async () => {
      const id = await cycleId();
      store[0].status = "unconfirmed";
      await handleConfirmationButton({ customer, payload: confirmationPayload(id, "confirm") });
      expect(mocks.setAppointmentsConfirmation).not.toHaveBeenCalled();
      expect(mocks.updateCustomerServiceStatus).toHaveBeenCalledWith(customerId, "waiting_human");
      expect(mocks.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("equipe da clínica vai verificar") }));
    });

    it("ignores buttons of other templates", async () => {
      await expect(handleConfirmationButton({ customer, payload: "QUERO_SABER_MAIS" })).resolves.toEqual({ handled: false });
    });
  });

  describe("attendance after a deposit", () => {
    const now = new Date("2026-11-05T18:00:00Z");

    it("confirms directly when the event is within the reminder period", async () => {
      await expect(applyAttendanceAfterPayment({ customerId, appointments: [{ _id: new ObjectId(), startAt: new Date("2026-11-06T13:00:00Z") }], now })).resolves.toBe("confirmed");
      expect(mocks.setAppointmentsConfirmation).toHaveBeenCalledWith(expect.objectContaining({ to: "confirmed" }));
    });

    it("keeps \"A confirmar\" further ahead, and confirms directly when the task is off", async () => {
      const appointments = [{ _id: new ObjectId(), startAt: new Date("2026-11-08T13:00:00Z") }];
      await expect(applyAttendanceAfterPayment({ customerId, appointments, now })).resolves.toBe("pending");
      expect(mocks.setAppointmentsConfirmation).not.toHaveBeenCalled();
      mocks.config = { ...mocks.config, enabled: false };
      await expect(applyAttendanceAfterPayment({ customerId, appointments, now })).resolves.toBe("confirmed");
    });
  });
});
