import { describe, expect, it } from "vitest";
import { getSlotAccessDecision, isSlotAllowedByAccessEvents, type CalendarAccessWindow } from "./access-policy";

const date = (value: string) => new Date(value);
const slotStart = date("2026-09-18T13:00:00.000Z");
const slotEnd = date("2026-09-18T14:00:00.000Z");

function event(input: Partial<CalendarAccessWindow> & Pick<CalendarAccessWindow, "type">): CalendarAccessWindow {
  return {
    type: input.type,
    startAt: input.startAt ?? date("2026-09-18T12:00:00.000Z"),
    endAt: input.endAt ?? date("2026-09-18T18:00:00.000Z"),
    resourceIds: input.resourceIds ?? [],
  };
}

describe("calendar access policy", () => {
  it("rejects a slot without an applicable permission", () => {
    expect(isSlotAllowedByAccessEvents([], "doctor", slotStart, slotEnd)).toBe(false);
  });

  it("accepts a slot fully contained in a global permission", () => {
    expect(isSlotAllowedByAccessEvents([event({ type: "permission" })], "doctor", slotStart, slotEnd)).toBe(true);
  });

  it("requires the entire slot to fit inside the permission", () => {
    expect(isSlotAllowedByAccessEvents([
      event({ type: "permission", endAt: date("2026-09-18T13:30:00.000Z") }),
    ], "doctor", slotStart, slotEnd)).toBe(false);
  });

  it("applies resource-specific permissions only to their targets", () => {
    const events = [event({ type: "permission", resourceIds: ["technician"] })];
    expect(isSlotAllowedByAccessEvents(events, "technician", slotStart, slotEnd)).toBe(true);
    expect(isSlotAllowedByAccessEvents(events, "doctor", slotStart, slotEnd)).toBe(false);
  });

  it("lets any overlapping global blocker win", () => {
    expect(isSlotAllowedByAccessEvents([
      event({ type: "permission" }),
      event({ type: "blocker", startAt: date("2026-09-18T13:30:00.000Z") }),
    ], "doctor", slotStart, slotEnd)).toBe(false);
  });

  it("ignores blockers for unrelated resources", () => {
    expect(isSlotAllowedByAccessEvents([
      event({ type: "permission" }),
      event({ type: "blocker", resourceIds: ["technician"] }),
    ], "doctor", slotStart, slotEnd)).toBe(true);
  });

  it("does not treat a blocker ending exactly at slot start as overlapping", () => {
    expect(isSlotAllowedByAccessEvents([
      event({ type: "permission" }),
      event({ type: "blocker", endAt: slotStart }),
    ], "doctor", slotStart, slotEnd)).toBe(true);
  });

  it("returns the conflicting blocker for precise manual-booking feedback", () => {
    const blocker = event({
      type: "blocker",
      resourceIds: ["doctor"],
      startAt: date("2026-09-18T13:30:00.000Z"),
    });
    const decision = getSlotAccessDecision([
      event({ type: "permission" }),
      blocker,
    ], "doctor", slotStart, slotEnd);

    expect(decision.permitted).toBe(true);
    expect(decision.blocker).toBe(blocker);
  });
});
