import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  insertOne: vi.fn(),
  replaceOne: vi.fn(),
  updateOne: vi.fn(),
  find: vi.fn(),
  sort: vi.fn(),
  limit: vi.fn(),
  toArray: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => mocks,
    }),
  }),
}));
vi.mock("../qualification/triggers", () => ({
  scheduleFirstAppointmentQualification: vi.fn(),
}));

import {
  findCustomerAppointments, findUpcomingCustomerAppointments, getCalendarSettings, updateCalendarSettings,
  type AppointmentDocument, type CalendarSettingsDocument,
} from "./calendar";

let initial: CalendarSettingsDocument;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.findOne.mockResolvedValue(null);
  initial = await getCalendarSettings();
  mocks.findOne.mockResolvedValue(initial);
  mocks.find.mockReturnValue(mocks);
  mocks.sort.mockReturnValue(mocks);
  mocks.limit.mockReturnValue(mocks);
  mocks.toArray.mockResolvedValue([]);
  mocks.replaceOne.mockImplementation(async (_filter, next: CalendarSettingsDocument) => {
    mocks.findOne.mockResolvedValue(next);
    return { acknowledged: true };
  });
});

describe("scheduled customer appointment queries", () => {
    const customerId = new ObjectId();
    const now = new Date("2026-10-23T16:00:00.000Z");

    function appointment(patch: Partial<AppointmentDocument> = {}): AppointmentDocument {
      return {
        _id: new ObjectId(), customerId, customerName: "Customer", contactPhone: "",
        providerId: "doctor", eventType: "consultation", timezone: "America/Sao_Paulo",
        startAt: new Date("2026-10-24T16:00:00.000Z"), endAt: new Date("2026-10-24T16:30:00.000Z"),
        status: "scheduled", source: "manual", createdAt: now, updatedAt: now,
        ...patch,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
    });
    afterEach(() => vi.useRealTimers());

    it("scopes the database query to the runtime customer, future starts and authorized scheduled events", async () => {
      const matching = appointment();
      const startingNow = appointment({ startAt: now });
      const farFuture = appointment({ startAt: new Date("2035-01-01T12:00:00.000Z") });
      const rows = [
        matching, startingNow, farFuture,
        appointment({ customerId: new ObjectId() }),
        appointment({ status: "held" }),
        appointment({ status: "cancelled" }),
        appointment({ status: "completed" }),
        appointment({ startAt: new Date("2026-10-23T15:59:59.999Z") }),
        appointment({ eventType: "internal" }),
      ];
      mocks.find.mockImplementation((query: {
        customerId: ObjectId;
        status: string;
        startAt: { $gte: Date };
        eventType: { $in: string[] };
      }) => {
        const matches = rows.filter((row) => (
          row.customerId?.equals(query.customerId) &&
          row.status === query.status &&
          row.startAt >= query.startAt.$gte &&
          query.eventType.$in.includes(row.eventType)
        )).sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
        mocks.toArray.mockResolvedValue(matches);
        return mocks;
      });

      const result = await findUpcomingCustomerAppointments({ customerId, eventTypes: ["consultation"] });

      expect(mocks.find).toHaveBeenCalledWith({
        customerId, status: "scheduled", startAt: { $gte: now }, eventType: { $in: ["consultation"] },
      });
      expect(mocks.sort).toHaveBeenCalledWith({ startAt: 1 });
      expect(mocks.limit).toHaveBeenCalledWith(51);
      expect(result).toEqual({ appointments: [startingNow, matching, farFuture], queriedAt: now, hasMore: false });
    });

    it.each([0, 49, 50, 51])("returns at most 50 of %i matching rows with an exact truncation indicator", async (count) => {
      const appointments = Array.from({ length: count }, () => appointment());
      mocks.toArray.mockResolvedValue(appointments);

      const result = await findUpcomingCustomerAppointments({ customerId, eventTypes: ["consultation"] });

      expect(result.appointments).toEqual(appointments.slice(0, 50));
      expect(result.hasMore).toBe(count > 50);
    });

    it("uses an empty database allowlist when the agent has no authorized event types", async () => {
      const result = await findUpcomingCustomerAppointments({ customerId, eventTypes: [] });

      expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ customerId, eventType: { $in: [] } }));
      expect(result.appointments).toEqual([]);
    });

    it("fails closed before any appointment query without a customer ID", async () => {
      // @ts-expect-error Exercise an invalid runtime boundary.
      await expect(findUpcomingCustomerAppointments({ customerId: undefined, eventTypes: ["consultation"] }))
        .rejects.toThrow("Cliente da consulta");
      expect(mocks.find).not.toHaveBeenCalled();
    });

    it("preserves date-bounded lookup behavior used by rescheduling", async () => {
      await findCustomerAppointments({
        customerId, fromDate: "2026-10-23", toDate: "2026-10-23", eventTypes: [], limit: 100,
      });

      expect(mocks.find).toHaveBeenCalledWith({
        customerId,
        status: "scheduled",
        startAt: { $gte: new Date("2026-10-23T03:00:00.000Z"), $lte: new Date("2026-10-24T02:59:59.999Z") },
      });
      expect(mocks.limit).toHaveBeenCalledWith(50);
    });
});

describe("calendar event type limit", () => {
  it.each([20, 21, 49, 50])("persists and reloads %i event types", async (count) => {
    const eventTypes = [
      ...initial.eventTypes,
      ...Array.from({ length: count - initial.eventTypes.length }, (_, index) => ({
        ...initial.eventTypes[0],
        key: `event_${index}`,
        name: `Event ${index}`,
      })),
    ];

    const saved = await updateCalendarSettings({ ...initial, eventTypes });

    expect(saved.eventTypes).toEqual(eventTypes);
    expect((await getCalendarSettings()).eventTypes).toEqual(eventTypes);
  });

  it.each([0, 51])("rejects %i event types without persisting them", async (count) => {
    const eventTypes = Array.from({ length: count }, (_, index) => ({
      ...initial.eventTypes[0],
      key: `event_${index}`,
      name: `Event ${index}`,
    }));

    await expect(updateCalendarSettings({ ...initial, eventTypes }))
      .rejects.toThrow("Configure entre 1 e 50 tipos de evento.");
    expect(mocks.replaceOne).not.toHaveBeenCalled();
  });
});

describe("calendar setting minute ranges", () => {
  it.each([1, 2, 7, 15, 17, 20, 25, 30, 45, 60, 75, 90, 120, 121, 480, 481, 720, 1439, 1440])(
    "persists and reloads a custom grid interval of %i minutes",
    async (minutes) => {
      const saved = await updateCalendarSettings({ ...initial, slotDurationMinutes: minutes });

      expect(saved.slotDurationMinutes).toBe(minutes);
      expect(saved.eventTypes).toEqual(initial.eventTypes);
      expect(mocks.replaceOne).toHaveBeenCalledWith(
        { _id: initial._id },
        expect.objectContaining({ slotDurationMinutes: minutes }),
        { upsert: true },
      );
      expect((await getCalendarSettings()).slotDurationMinutes).toBe(minutes);
    },
  );

  it.each([1, 2, 7, 17, 25, 75, 480, 481, 720, 1439, 1440])(
    "persists and reloads an event type duration of %i minutes",
    async (minutes) => {
      const eventTypes = initial.eventTypes.map((eventType, index) => (
        index === 0 ? { ...eventType, durationMinutes: minutes } : eventType
      ));
      const saved = await updateCalendarSettings({ ...initial, eventTypes });

      expect(saved.eventTypes).toEqual(eventTypes);
      expect(saved.slotDurationMinutes).toBe(initial.slotDurationMinutes);
      expect((await getCalendarSettings()).eventTypes).toEqual(eventTypes);
    },
  );

  it.each([0, -1, 1441, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects an invalid grid interval of %s without persisting it",
    async (minutes) => {
      await expect(updateCalendarSettings({ ...initial, slotDurationMinutes: minutes }))
        .rejects.toThrow("O intervalo da grade deve ser um n\u00famero inteiro entre 1 e 1440 minutos.");
      expect(mocks.replaceOne).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1441, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects an invalid event type duration of %s without persisting it",
    async (minutes) => {
      const eventTypes = initial.eventTypes.map((eventType, index) => (
        index === 0 ? { ...eventType, durationMinutes: minutes } : eventType
      ));

      await expect(updateCalendarSettings({ ...initial, eventTypes }))
        .rejects.toThrow("A dura\u00e7\u00e3o do tipo deve ser um n\u00famero inteiro entre 1 e 1440 minutos.");
      expect(mocks.replaceOne).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1441, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "preserves the legacy default for an invalid stored grid interval of %s",
    async (minutes) => {
      mocks.findOne.mockResolvedValue({ ...initial, slotDurationMinutes: minutes });

      expect((await getCalendarSettings()).slotDurationMinutes).toBe(30);
      expect(mocks.updateOne).toHaveBeenCalledWith(
        { _id: initial._id },
        expect.objectContaining({
          $set: expect.objectContaining({ slotDurationMinutes: 30 }),
        }),
      );
    },
  );
});
