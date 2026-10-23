import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  insertOne: vi.fn(),
  replaceOne: vi.fn(),
  updateOne: vi.fn(),
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

import { getCalendarSettings, updateCalendarSettings, type CalendarSettingsDocument } from "./calendar";

let initial: CalendarSettingsDocument;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.findOne.mockResolvedValue(null);
  initial = await getCalendarSettings();
  mocks.findOne.mockResolvedValue(initial);
  mocks.replaceOne.mockImplementation(async (_filter, next: CalendarSettingsDocument) => {
    mocks.findOne.mockResolvedValue(next);
    return { acknowledged: true };
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
