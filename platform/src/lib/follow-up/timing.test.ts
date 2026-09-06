import { describe, expect, it } from "vitest";
import { getNextActiveWindowStart, getNextFollowUpAt, isWithinFollowUpWindow } from "./timing";

const policy = {
  intervalMinutes: 120,
  activeStartHour: 8,
  activeEndHour: 20,
  maxHoursSinceInbound: 24,
  timezone: "America/Sao_Paulo",
};

describe("follow-up timing", () => {
  it("schedules two hours later during the active window", () => {
    const next = getNextFollowUpAt({
      from: new Date("2026-09-06T13:00:00.000Z"),
      lastInboundAt: new Date("2026-09-06T12:55:00.000Z"),
      policy,
    });

    expect(next?.toISOString()).toBe("2026-09-06T15:00:00.000Z");
  });

  it("moves a follow-up in quiet hours to 08:00 the next day", () => {
    const next = getNextFollowUpAt({
      from: new Date("2026-09-06T22:30:00.000Z"),
      lastInboundAt: new Date("2026-09-06T20:00:00.000Z"),
      policy,
    });

    expect(next?.toISOString()).toBe("2026-09-07T11:00:00.000Z");
  });

  it("does not schedule at or after the WhatsApp 24-hour cutoff", () => {
    const next = getNextFollowUpAt({
      from: new Date("2026-09-07T10:00:00.000Z"),
      lastInboundAt: new Date("2026-09-06T11:00:00.000Z"),
      policy,
    });

    expect(next).toBeNull();
  });

  it("treats 20:00 as the beginning of quiet hours", () => {
    expect(isWithinFollowUpWindow(new Date("2026-09-06T22:59:00.000Z"), policy)).toBe(true);
    expect(isWithinFollowUpWindow(new Date("2026-09-06T23:00:00.000Z"), policy)).toBe(false);
    expect(getNextActiveWindowStart(new Date("2026-09-06T23:00:00.000Z"), policy).toISOString()).toBe("2026-09-07T11:00:00.000Z");
  });
});