import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  insertOne: vi.fn(),
  replaceOne: vi.fn(),
  updateOne: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
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
  attachPaymentToAppointments, confirmAppointmentHolds, extendAppointmentHolds,
  findCustomerAppointments, findUpcomingCustomerAppointments, getCalendarSettings, listAppointmentsAwaitingConfirmation, updateCalendarSettings,
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

describe("appointments awaiting attendance confirmation", () => {
  it("only lists bookings linked to a patient (staff bookings may have customerId null)", async () => {
    const from = new Date("2026-11-04T05:45:00Z");
    const to = new Date("2026-11-05T18:45:00Z");
    await listAppointmentsAwaitingConfirmation({ from, to });

    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({
      customerId: { $type: "objectId" }, status: "scheduled", startAt: { $gt: from, $lte: to },
    }));
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

    it("returns all of the runtime customer's future scheduled appointments and only unexpired holds", async () => {
      const matching = appointment();
      const startingNow = appointment({ startAt: now });
      const pending = appointment({ confirmationStatus: "pending", startAt: new Date("2026-10-26T19:00:00Z") });
      const held = appointment({ status: "held", holdExpiresAt: new Date("2026-10-23T17:00:00Z"), startAt: new Date("2026-10-27T19:00:00Z") });
      const nonBookable = appointment({ eventType: "subsequent_consultation", confirmationStatus: "confirmed", startAt: new Date("2026-10-28T19:00:00Z") });
      const farFuture = appointment({ startAt: new Date("2035-01-01T12:00:00.000Z") });
      const rows = [
        matching, startingNow, pending, held, nonBookable, farFuture,
        appointment({ customerId: new ObjectId() }),
        appointment({ status: "held" }),
        appointment({ status: "held", holdExpiresAt: now }),
        appointment({ status: "held", holdExpiresAt: new Date("2026-10-23T15:59:59.999Z") }),
        appointment({ status: "held", holdExpiresAt: new Date("2026-10-23T17:00:00Z"), startAt: new Date("2026-10-23T15:00:00Z") }),
        appointment({ status: "cancelled" }),
        appointment({ status: "completed" }),
        appointment({ startAt: new Date("2026-10-23T15:59:59.999Z") }),
      ];
      mocks.find.mockImplementation((query: {
        customerId: ObjectId;
        startAt: { $gte: Date };
        $or: [{ status: string }, { status: string; holdExpiresAt: { $gt: Date } }];
      }) => {
        const matches = rows.filter((row) => (
          row.customerId?.equals(query.customerId) &&
          row.startAt >= query.startAt.$gte &&
          (row.status === query.$or[0].status ||
            (row.status === query.$or[1].status && row.holdExpiresAt && row.holdExpiresAt > query.$or[1].holdExpiresAt.$gt))
        )).sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
        mocks.toArray.mockResolvedValue(matches);
        return mocks;
      });

      const result = await findUpcomingCustomerAppointments({ customerId });

      expect(mocks.find).toHaveBeenCalledWith({
        customerId, companyId: legacyCompanyId(), startAt: { $gte: now },
        $or: [{ status: "scheduled" }, { status: "held", holdExpiresAt: { $gt: now } }],
      });
      expect(mocks.sort).toHaveBeenCalledWith({ startAt: 1 });
      expect(mocks.limit).toHaveBeenCalledWith(51);
      expect(result).toEqual({ appointments: [startingNow, matching, pending, held, nonBookable, farFuture], queriedAt: now, hasMore: false });
    });

    it.each([0, 49, 50, 51])("returns at most 50 of %i matching rows with an exact truncation indicator", async (count) => {
      const appointments = Array.from({ length: count }, () => appointment());
      mocks.toArray.mockResolvedValue(appointments);

      const result = await findUpcomingCustomerAppointments({ customerId });

      expect(result.appointments).toEqual(appointments.slice(0, 50));
      expect(result.hasMore).toBe(count > 50);
    });

    it("does not apply booking or attendance-confirmation filters to read visibility", async () => {
      await findUpcomingCustomerAppointments({ customerId });

      const query = mocks.find.mock.calls[0][0];
      expect(query).not.toHaveProperty("eventType");
      expect(query).not.toHaveProperty("confirmationStatus");
    });

    it("fails closed before any appointment query without a customer ID", async () => {
      // @ts-expect-error Exercise an invalid runtime boundary.
      await expect(findUpcomingCustomerAppointments({ customerId: undefined }))
        .rejects.toThrow("Cliente da consulta");
      expect(mocks.find).not.toHaveBeenCalled();
    });

    it("preserves date-bounded lookup behavior used by rescheduling", async () => {
      await findCustomerAppointments({
        customerId, fromDate: "2026-10-23", toDate: "2026-10-23", eventTypes: [], limit: 100,
      });

      expect(mocks.find).toHaveBeenCalledWith({
        customerId,
        companyId: legacyCompanyId(),
        status: "scheduled",
        startAt: { $gte: new Date("2026-10-23T03:00:00.000Z"), $lte: new Date("2026-10-24T02:59:59.999Z") },
      });
      expect(mocks.limit).toHaveBeenCalledWith(50);
    });

    it("includes valid holds in authorized rescheduling target lookup only when requested", async () => {
      await findCustomerAppointments({
        customerId, fromDate: "2026-10-23", toDate: "2026-10-30",
        eventTypes: ["consultation"], includeActiveHolds: true,
      });

      expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({
        customerId, eventType: { $in: ["consultation"] },
        $or: [{ status: "scheduled" }, { status: "held", holdExpiresAt: { $gt: now } }],
      }));
    });
});

describe("deposit confirmation and holds", () => {
  const customerId = new ObjectId();
  const start = new Date(Date.now() + 5 * 24 * 3_600_000);
  const held = (holdExpiresAt: Date) => ({ _id: new ObjectId(), customerId, status: "held", startAt: start, holdExpiresAt });

  it("turns paid holds into bookings awaiting attendance confirmation, linked to the payment", async () => {
    const paymentRequestId = new ObjectId();
    mocks.toArray.mockResolvedValue([held(new Date(Date.now() + 3_600_000))]);
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const [confirmed] = await confirmAppointmentHolds(customerId, { paymentRequestId });

    const [, update] = mocks.updateMany.mock.calls[0];
    expect(update.$set).toMatchObject({ status: "scheduled", confirmationStatus: "pending", paymentRequestId, paidAt: expect.any(Date) });
    expect(update.$unset).toEqual({ holdExpiresAt: "", schedulingOptionId: "" });
    expect(confirmed).toMatchObject({ status: "scheduled", confirmationStatus: "pending", paymentRequestId });
  });

  it("confirms only the booking the deposit was requested for", async () => {
    const paymentRequestId = new ObjectId();
    const allocated = held(new Date(Date.now() + 3_600_000));
    mocks.toArray.mockResolvedValueOnce([allocated]);
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const paidAt = new Date("2026-10-01T12:00:00Z");

    const confirmed = await confirmAppointmentHolds(customerId, { paymentRequestId, appointmentIds: [allocated._id], paidAt });

    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ customerId, status: "held", _id: { $in: [allocated._id] } }));
    expect(mocks.find).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany.mock.calls[0][1].$set).toMatchObject({ paymentRequestId, paidAt });
    expect(confirmed.map((appointment) => appointment._id)).toEqual([allocated._id]);
  });

  it("confirms the patient's current holds when the allocated hold was replaced by another time", async () => {
    const current = held(new Date(Date.now() + 3_600_000));
    mocks.toArray.mockResolvedValueOnce([]).mockResolvedValueOnce([current]);
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const confirmed = await confirmAppointmentHolds(customerId, { paymentRequestId: new ObjectId(), appointmentIds: [new ObjectId()] });

    expect(confirmed.map((appointment) => appointment._id)).toEqual([current._id]);
  });

  it("links a payment set by staff: held appointments become 'A confirmar', bookings only record it", async () => {
    const paymentRequestId = new ObjectId();
    const hold = held(new Date(Date.now() + 3_600_000));
    const booked = new ObjectId();
    mocks.toArray.mockResolvedValueOnce([{ _id: hold._id }]);
    mocks.updateMany.mockResolvedValue({ matchedCount: 2 });
    const paidAt = new Date("2026-10-01T12:00:00Z");

    await attachPaymentToAppointments({ customerId, appointmentIds: [hold._id, booked], paymentRequestId, paidAt });

    const [[heldFilter, heldUpdate], [bookedFilter, bookedUpdate]] = mocks.updateMany.mock.calls;
    expect(heldFilter).toMatchObject({ _id: { $in: [hold._id] }, status: "held" });
    expect(heldUpdate.$set).toMatchObject({ status: "scheduled", confirmationStatus: "pending", paymentRequestId, paidAt });
    expect(bookedFilter).toMatchObject({ _id: { $in: [hold._id, booked] }, customerId, status: { $in: ["scheduled", "completed"] } });
    expect(bookedUpdate.$set).toMatchObject({ paymentRequestId, paidAt });
  });

  it("extends holds until the payment expires, never past the appointment's start and never shortening them", async () => {
    mocks.toArray.mockResolvedValue([held(new Date(Date.now() + 3_600_000))]);

    const target = await extendAppointmentHolds(customerId, new Date(start.getTime() + 24 * 3_600_000));

    expect(target).toEqual(start);
    const [filter, update] = mocks.updateMany.mock.calls[0];
    expect(filter.holdExpiresAt).toEqual({ $gt: expect.any(Date), $lt: start });
    expect(update.$set.holdExpiresAt).toEqual(start);
  });

  it("does nothing when there is no active hold", async () => {
    mocks.toArray.mockResolvedValue([]);
    await expect(extendAppointmentHolds(customerId, new Date(Date.now() + 3_600_000))).resolves.toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("new clinic calendar", () => {
  it("starts without professionals or event types and does not add the original clinic's ones back", async () => {
    const { runWithCompany } = await import("../companies/context");
    const companyId = new ObjectId();
    mocks.findOne.mockResolvedValue(null);
    const created = await runWithCompany(companyId, () => getCalendarSettings());
    expect(created.resources).toEqual([]);
    expect(created.eventTypes).toEqual([]);
    expect(mocks.insertOne).toHaveBeenLastCalledWith(expect.objectContaining({ _id: `${companyId.toHexString()}:default-calendar`, companyId, resources: [], eventTypes: [] }));

    const own = { key: "avaliacao", name: "Avaliação", color: "#0F766E", durationMinutes: 45, resourceId: "dra" };
    mocks.findOne.mockResolvedValue({ ...created, resources: [{ id: "dra", name: "Dra. Ana", weeklyAvailability: created.weeklyAvailability }], eventTypes: [own] });
    const stored = await runWithCompany(companyId, () => getCalendarSettings());
    expect(stored.resources.map((resource) => resource.id)).toEqual(["dra"]);
    expect(stored.eventTypes.map((eventType) => eventType.key)).toEqual(["avaliacao"]);
  });

  it("keeps the original clinic's required professionals and event types", async () => {
    expect(initial.resources.map((resource) => resource.id)).toEqual(expect.arrayContaining(["doctor", "technician"]));
    expect(initial.eventTypes.map((eventType) => eventType.key)).toEqual(expect.arrayContaining(["doctor_consultation", "bioimpedance"]));
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
        { _id: initial._id, companyId: legacyCompanyId() },
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
        { _id: initial._id, companyId: legacyCompanyId() },
        expect.objectContaining({
          $set: expect.objectContaining({ slotDurationMinutes: 30 }),
        }),
      );
    },
  );
});
