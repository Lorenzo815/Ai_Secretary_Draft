import { describe, expect, it } from "vitest";
import { buildAppointmentRecurrenceStarts } from "./recurrence";

const timezone = "America/Sao_Paulo";

function isoDates(values: ReturnType<typeof buildAppointmentRecurrenceStarts>) {
  return values.map((value) => value.toFormat("yyyy-MM-dd HH:mm"));
}

describe("calendar recurrence", () => {
  it("generates a daily series by count without changing local time", () => {
    const values = buildAppointmentRecurrenceStarts(
      "2026-09-28T09:30:00-03:00",
      { frequency: "daily", interval: 1, endMode: "count", count: 3 },
      timezone,
    );
    expect(isoDates(values)).toEqual([
      "2026-09-28 09:30",
      "2026-09-29 09:30",
      "2026-09-30 09:30",
    ]);
  });

  it("supports weekly intervals and an inclusive final date", () => {
    const values = buildAppointmentRecurrenceStarts(
      "2026-09-28T09:30:00-03:00",
      { frequency: "weekly", interval: 2, endMode: "until", untilDate: "2026-10-26" },
      timezone,
    );
    expect(isoDates(values)).toEqual([
      "2026-09-28 09:30",
      "2026-10-12 09:30",
      "2026-10-26 09:30",
    ]);
  });

  it("calculates monthly occurrences from the original date instead of drifting", () => {
    const values = buildAppointmentRecurrenceStarts(
      "2027-01-31T14:00:00-03:00",
      { frequency: "monthly", interval: 1, endMode: "count", count: 3 },
      timezone,
    );
    expect(isoDates(values)).toEqual([
      "2027-01-31 14:00",
      "2027-02-28 14:00",
      "2027-03-31 14:00",
    ]);
  });

  it("rejects count and interval limits instead of silently truncating", () => {
    expect(() => buildAppointmentRecurrenceStarts(
      "2026-09-28T09:30:00-03:00",
      { frequency: "daily", interval: 1, endMode: "count", count: 367 },
      timezone,
    )).toThrow("entre 2 e 366");
    expect(() => buildAppointmentRecurrenceStarts(
      "2026-09-28T09:30:00-03:00",
      { frequency: "daily", interval: 31, endMode: "count", count: 2 },
      timezone,
    )).toThrow("entre 1 e 30");
  });

  it("rejects an end date that would create more than 366 occurrences", () => {
    expect(() => buildAppointmentRecurrenceStarts(
      "2026-01-01T09:30:00-03:00",
      { frequency: "daily", interval: 1, endMode: "until", untilDate: "2027-01-02" },
      timezone,
    )).toThrow("não pode ultrapassar 366");
  });

  it("requires at least two occurrences and limits the horizon to two years", () => {
    expect(() => buildAppointmentRecurrenceStarts(
      "2026-09-28T09:30:00-03:00",
      { frequency: "weekly", interval: 1, endMode: "until", untilDate: "2026-09-28" },
      timezone,
    )).toThrow("ao menos duas");
    expect(() => buildAppointmentRecurrenceStarts(
      "2026-09-28T09:30:00-03:00",
      { frequency: "monthly", interval: 1, endMode: "until", untilDate: "2028-09-29" },
      timezone,
    )).toThrow("próximos dois anos");
  });
});
