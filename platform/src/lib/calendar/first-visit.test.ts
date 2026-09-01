import { describe, expect, it } from "vitest";
import { getReferencedFirstVisitOptionId, isCurrentFirstVisitOption, selectFirstVisitCandidate } from "./first-visit";

const slot = (startAt: string, endAt: string) => ({ startAt, endAt, label: startAt });

describe("first-visit planning", () => {
  it("combines independently filtered dates and exact times", () => {
    const candidate = selectFirstVisitCandidate({
      bioimpedanceSlots: [slot("2026-09-04T09:00:00.000-03:00", "2026-09-04T09:30:00.000-03:00")],
      consultationSlots: [slot("2026-09-07T09:00:00.000-03:00", "2026-09-07T10:00:00.000-03:00")],
      preference: "separate",
      offeredPairs: new Set(),
    });

    expect(candidate?.bioimpedance.startAt).toContain("2026-09-04T09:00");
    expect(candidate?.consultation.startAt).toContain("2026-09-07T09:00");
  });

  it("only combines contiguous appointments when requested together", () => {
    const candidate = selectFirstVisitCandidate({
      bioimpedanceSlots: [slot("2026-09-04T09:00:00.000-03:00", "2026-09-04T09:30:00.000-03:00")],
      consultationSlots: [
        slot("2026-09-04T10:00:00.000-03:00", "2026-09-04T11:00:00.000-03:00"),
        slot("2026-09-04T09:30:00.000-03:00", "2026-09-04T10:30:00.000-03:00"),
      ],
      preference: "together",
      offeredPairs: new Set(),
    });

    expect(candidate?.consultation.startAt).toContain("2026-09-04T09:30");
  });

  it("does not retain an option after its state reference is removed", () => {
    expect(getReferencedFirstVisitOptionId(["optionId=6a9752eb91e3637d56cb71dc"]))
      .toBe("6a9752eb91e3637d56cb71dc");
    expect(getReferencedFirstVisitOptionId(["previousOptionRejected", "consultation=segunda 09:00"]))
      .toBeUndefined();
    expect(isCurrentFirstVisitOption("6a9752eb91e3637d56cb71dc")).toBe(false);
    expect(isCurrentFirstVisitOption(
      "6a9752eb91e3637d56cb71dc",
      "6a9752eb91e3637d56cb71dc",
    )).toBe(true);
  });
});