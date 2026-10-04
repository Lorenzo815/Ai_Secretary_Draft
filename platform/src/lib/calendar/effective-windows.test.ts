import { describe, expect, it } from "vitest";
import { getEffectiveDayWindows, type EffectiveWindowResource } from "./effective-windows";

const timezone = "America/Sao_Paulo";
const resource: EffectiveWindowResource = {
  id: "doctor",
  weeklyAvailability: [{
    weekday: 1,
    enabled: true,
    intervals: [{ startTime: "09:00", endTime: "12:00" }, { startTime: "13:00", endTime: "17:00" }],
  }],
};

describe("effective calendar windows", () => {
  it("intersects weekly availability with permissions", () => {
    expect(getEffectiveDayWindows("2026-10-05", timezone, resource, [{
      type: "permission",
      startAt: "2026-10-05T13:30:00.000Z",
      endAt: "2026-10-05T18:30:00.000Z",
      resourceIds: [],
    }]).map(({ startTime, endTime }) => `${startTime}-${endTime}`)).toEqual(["10:30-12:00", "13:00-15:30"]);
  });

  it("subtracts blockers and keeps both remaining intervals", () => {
    expect(getEffectiveDayWindows("2026-10-05", timezone, resource, [
      {
        type: "permission",
        startAt: "2026-10-05T12:00:00.000Z",
        endAt: "2026-10-05T20:00:00.000Z",
        resourceIds: [],
      },
      {
        type: "blocker",
        startAt: "2026-10-05T13:00:00.000Z",
        endAt: "2026-10-05T14:00:00.000Z",
        resourceIds: ["doctor"],
      },
    ]).map(({ startTime, endTime }) => `${startTime}-${endTime}`)).toEqual(["09:00-10:00", "11:00-12:00", "13:00-17:00"]);
  });

  it("ignores permissions for another professional", () => {
    expect(getEffectiveDayWindows("2026-10-05", timezone, resource, [{
      type: "permission",
      startAt: "2026-10-05T12:00:00.000Z",
      endAt: "2026-10-05T20:00:00.000Z",
      resourceIds: ["technician"],
    }])).toEqual([]);
  });

  it("returns no effective window without a permission or weekly availability", () => {
    expect(getEffectiveDayWindows("2026-10-05", timezone, resource, [])).toEqual([]);
    expect(getEffectiveDayWindows("2026-10-06", timezone, resource, [{
      type: "permission",
      startAt: "2026-10-06T12:00:00.000Z",
      endAt: "2026-10-06T20:00:00.000Z",
      resourceIds: [],
    }])).toEqual([]);
  });
});
