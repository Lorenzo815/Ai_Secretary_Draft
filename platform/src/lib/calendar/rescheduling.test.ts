import { MongoClient, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  find: vi.fn(),
  bulkWrite: vi.fn(),
  deleteMany: vi.fn(),
  startSession: vi.fn(),
  withTransaction: vi.fn(),
  endSession: vi.fn(),
}));
vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection: mocks.collection }),
    startSession: mocks.startSession,
  }),
}));
vi.mock("../qualification/triggers", () => ({ scheduleFirstAppointmentQualification: vi.fn() }));

import { updateCustomerAppointments, type AppointmentDocument, type CalendarAccessEventDocument } from "./calendar";

describe("customer appointment rescheduling lifecycle", () => {
  const now = new Date("2026-10-23T16:00:00Z");
  const newStartAt = "2026-10-28T13:00:00Z";
  const expiresAt = new Date("2026-10-23T18:00:00Z");
  const session = { withTransaction: mocks.withTransaction, endSession: mocks.endSession };
  let appointment: AppointmentDocument;
  let rows: AppointmentDocument[];
  let accessEvents: CalendarAccessEventDocument[];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    appointment = {
      _id: new ObjectId(), customerId: new ObjectId(), customerName: "Customer", contactPhone: "",
      eventType: "consultation", providerId: "doctor", timezone: "America/Sao_Paulo",
      status: "held", holdExpiresAt: new Date("2026-10-23T16:30:00Z"), confirmationStatus: "pending",
      startAt: new Date("2026-10-26T13:00:00Z"), endAt: new Date("2026-10-26T13:30:00Z"),
      schedulingOptionId: new ObjectId(), visitGroupId: new ObjectId(), notes: "Keep these notes",
      source: "assistant", createdAt: now, updatedAt: new Date("2026-10-23T15:00:00Z"),
    };
    rows = [appointment];
    accessEvents = [{
      _id: new ObjectId(), type: "permission", title: "Open", resourceIds: [],
      startAt: new Date("2026-10-01T00:00:00Z"), endAt: new Date("2026-11-01T00:00:00Z"),
      createdAt: now, updatedAt: now,
    }];
    mocks.collection.mockImplementation((name: string) => {
      if (name === "calendar_appointments") return mocks;
      if (name === "calendar_settings") return { findOne: async () => null, insertOne: vi.fn() };
      if (name === "calendar_access_events") return { find: () => cursor(accessEvents) };
      throw new Error(`Unexpected collection access: ${name}`);
    });
    mocks.find.mockImplementation((filter: {
      _id?: { $in: ObjectId[] };
      customerId?: ObjectId;
      status?: string;
      holdExpiresAt?: { $gt: Date };
      startAt?: { $gte: Date; $lt: Date };
    }) => cursor(rows.filter(row => (
      (!filter._id || filter._id.$in.some(id => row._id.equals(id))) &&
      (!filter.customerId || row.customerId?.equals(filter.customerId)) &&
      (!filter.status || row.status === filter.status) &&
      (!filter.holdExpiresAt || (row.holdExpiresAt && row.holdExpiresAt > filter.holdExpiresAt.$gt)) &&
      (!filter.startAt || (row.startAt >= filter.startAt.$gte && row.startAt < filter.startAt.$lt))
    ))));
    mocks.bulkWrite.mockImplementation(async (operations: Array<{
      updateOne: {
        filter: { _id: ObjectId; customerId: ObjectId; status: string; updatedAt: Date; holdExpiresAt?: { $gt: Date } };
        update: { $set: Partial<AppointmentDocument>; $unset?: { notes: string } };
      };
    }>) => {
      let modifiedCount = 0;
      for (const { updateOne: { filter, update } } of operations) {
        const row = rows.find(item => item._id.equals(filter._id));
        if (!row || !row.customerId?.equals(filter.customerId) || row.status !== filter.status ||
          row.updatedAt.getTime() !== filter.updatedAt.getTime() ||
          (filter.holdExpiresAt && (!row.holdExpiresAt || row.holdExpiresAt <= filter.holdExpiresAt.$gt))) continue;
        Object.assign(row, update.$set);
        if (update.$unset) delete row.notes;
        modifiedCount += 1;
      }
      return { modifiedCount };
    });
    mocks.startSession.mockReturnValue(session);
    mocks.withTransaction.mockImplementation(async (callback: () => Promise<void>) => {
      const before = rows.map(row => ({ ...row }));
      try { await callback(); }
      catch (error) { rows = before; throw error; }
    });
  });
  afterEach(() => vi.useRealTimers());

  function move(hold = true) {
    return updateCustomerAppointments({
      customerId: appointment.customerId!,
      appointments: [{ appointmentId: appointment._id, startAt: newStartAt }],
      ...(hold ? { hold: { expiresAt } } : {}),
    });
  }

  it("moves the original held appointment without booking it or changing its customer, group or payment linkage", async () => {
    const before = { ...appointment };
    const [updated] = await move();

    expect(updated).toEqual({
      ...before, startAt: new Date(newStartAt), endAt: new Date("2026-10-28T13:30:00Z"),
      holdExpiresAt: expiresAt, updatedAt: now,
    });
    expect(rows).toHaveLength(1);
    expect(mocks.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({ updateOne: expect.objectContaining({
        filter: expect.objectContaining({
          _id: before._id, customerId: before.customerId, status: "held", updatedAt: before.updatedAt,
          holdExpiresAt: { $gt: now },
        }),
      }) }),
    ], { ordered: true, session });
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("keeps the default scheduled-appointment path unchanged", async () => {
    appointment.status = "scheduled";
    delete appointment.holdExpiresAt;

    expect((await move(false))[0]).toMatchObject({ status: "scheduled", startAt: new Date(newStartAt) });
    expect(mocks.bulkWrite.mock.calls[0][0][0].updateOne.filter).not.toHaveProperty("holdExpiresAt");
    expect(mocks.bulkWrite.mock.calls[0][0][0].updateOne.update.$set).not.toHaveProperty("holdExpiresAt");
  });

  it.each(["expired", "paid", "cancelled", "another customer"] as const)("refuses a hold that is %s", async (state) => {
    if (state === "expired") appointment.holdExpiresAt = now;
    if (state === "paid") appointment.status = "scheduled";
    if (state === "cancelled") appointment.status = "cancelled";
    if (state === "another customer") rows = [{ ...appointment, customerId: new ObjectId() }];

    await expect(move()).rejects.toThrow("não foram encontrados");
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });

  it("preserves appointment conflicts, calendar blockers and opening-hour checks for held moves", async () => {
    const collision = { ...appointment, _id: new ObjectId(), startAt: new Date(newStartAt), endAt: new Date("2026-10-28T13:30:00Z") };
    rows.push(collision);
    await expect(move()).rejects.toThrow("não está disponível");
    rows.pop();
    accessEvents.push({ ...accessEvents[0], _id: new ObjectId(), type: "blocker", startAt: collision.startAt, endAt: collision.endAt });
    await expect(move()).rejects.toThrow("não está disponível");
    accessEvents.pop();
    await expect(updateCustomerAppointments({
      customerId: appointment.customerId!,
      appointments: [{ appointmentId: appointment._id, startAt: "2026-10-28T23:00:00Z" }],
      hold: { expiresAt },
    })).rejects.toThrow("não está disponível");
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });

  it("does not resurrect a hold with an expired renewal or a deadline after the new start", async () => {
    for (const invalidExpiry of [now, new Date("2026-10-28T14:00:00Z")]) {
      await expect(updateCustomerAppointments({
        customerId: appointment.customerId!,
        appointments: [{ appointmentId: appointment._id, startAt: newStartAt }],
        hold: { expiresAt: invalidExpiry },
      })).rejects.toThrow(invalidExpiry === now ? "deve ser futuro" : "depois do início");
    }
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });

  it("fails explicitly when the appointment changes between lookup and write", async () => {
    mocks.bulkWrite.mockResolvedValueOnce({ modifiedCount: 0 });

    await expect(move()).rejects.toThrow("alterados por outra operação");

    expect(rows[0].startAt).toEqual(new Date("2026-10-26T13:00:00Z"));
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("propagates a partial-write failure so the transaction rolls the hold back", async () => {
    const before = { ...appointment };
    mocks.bulkWrite.mockImplementationOnce(async operations => {
      Object.assign(rows[0], operations[0].updateOne.update.$set);
      throw new Error("Write failed");
    });

    await expect(move()).rejects.toThrow("Write failed");

    expect(rows).toEqual([before]);
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("uses but never commits or ends a caller-owned transaction", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const callerSession = client.startSession();
    try {
      await updateCustomerAppointments({
        customerId: appointment.customerId!,
        appointments: [{ appointmentId: appointment._id, startAt: newStartAt }],
        hold: { expiresAt }, session: callerSession,
      });

      expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ customerId: appointment.customerId }), { session: callerSession });
      expect(mocks.bulkWrite).toHaveBeenCalledWith(expect.any(Array), { ordered: true, session: callerSession });
      expect(mocks.withTransaction).not.toHaveBeenCalled();
      expect(mocks.startSession).not.toHaveBeenCalled();
      expect(callerSession.hasEnded).toBe(false);
    } finally {
      await callerSession.endSession();
      await client.close();
    }
  });
});

function cursor<T>(rows: T[]) {
  return { toArray: async () => rows, sort: () => ({ toArray: async () => rows }) };
}
