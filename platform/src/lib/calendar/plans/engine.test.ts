import { describe, expect, it } from "vitest";
import type { SchedulingPlan } from "../../assistant/agent/contracts";
import { selectSchedulingPlanCandidate, selectSchedulingPlanCandidates, type PlanSlot } from "./engine";

const slot = (startAt: string, endAt: string): PlanSlot => ({ startAt, endAt, label: startAt });

const basePlan: SchedulingPlan = {
  key: "initial-care",
  name: "Atendimento inicial",
  description: "",
  enabled: true,
  steps: [
    { key: "assessment", eventTypeKey: "assessment", label: "Avaliação", required: true },
    { key: "consultation", eventTypeKey: "consultation", label: "Consulta", required: true },
  ],
  constraints: [],
  prerequisites: {},
  proposalExpiryMinutes: 30,
};

function select(plan: SchedulingPlan, assessment: PlanSlot[], consultation: PlanSlot[], preference: "compact" | "flexible") {
  return selectSchedulingPlanCandidate({
    plan,
    slotsByStep: new Map([
      ["assessment", assessment],
      ["consultation", consultation],
    ]),
    preference,
    offeredSignatures: new Set(),
  });
}

describe("scheduling plan selection", () => {
  it("enforces ordered steps", () => {
    const candidate = select(
      { ...basePlan, constraints: [{ type: "ordered", before: "assessment", after: "consultation" }] },
      [slot("2026-09-04T10:00:00-03:00", "2026-09-04T10:30:00-03:00")],
      [
        slot("2026-09-04T09:00:00-03:00", "2026-09-04T10:00:00-03:00"),
        slot("2026-09-04T10:30:00-03:00", "2026-09-04T11:30:00-03:00"),
      ],
      "flexible",
    );

    expect(candidate?.[1].slot.startAt).toContain("10:30");
  });

  it("allows ordered steps on different days when same-day is not configured", () => {
    const candidate = select(
      { ...basePlan, constraints: [{ type: "ordered", before: "assessment", after: "consultation" }] },
      [slot("2026-09-08T18:00:00-03:00", "2026-09-08T18:30:00-03:00")],
      [slot("2026-09-09T09:00:00-03:00", "2026-09-09T10:30:00-03:00")],
      "flexible",
    );

    expect(candidate?.[0].slot.startAt).toContain("2026-09-08T18:00");
    expect(candidate?.[1].slot.startAt).toContain("2026-09-09T09:00");
  });

  it("enforces minimum and maximum gaps", () => {
    const candidate = select(
      { ...basePlan, constraints: [{ type: "gap", from: "assessment", to: "consultation", minMinutes: 30, maxMinutes: 60 }] },
      [slot("2026-09-04T09:00:00-03:00", "2026-09-04T09:30:00-03:00")],
      [
        slot("2026-09-04T09:45:00-03:00", "2026-09-04T10:45:00-03:00"),
        slot("2026-09-04T10:00:00-03:00", "2026-09-04T11:00:00-03:00"),
      ],
      "flexible",
    );

    expect(candidate?.[1].slot.startAt).toContain("10:00");
  });

  it("enforces same-day groups", () => {
    const candidate = select(
      { ...basePlan, constraints: [{ type: "same_day", steps: ["assessment", "consultation"] }] },
      [slot("2026-09-04T09:00:00-03:00", "2026-09-04T09:30:00-03:00")],
      [
        slot("2026-09-05T09:30:00-03:00", "2026-09-05T10:30:00-03:00"),
        slot("2026-09-04T11:00:00-03:00", "2026-09-04T12:00:00-03:00"),
      ],
      "flexible",
    );

    expect(candidate?.[1].slot.startAt).toContain("2026-09-04");
  });

  it("prefers adjacency but keeps a non-adjacent compact fallback", () => {
    const assessment = [slot("2026-09-04T09:00:00-03:00", "2026-09-04T09:30:00-03:00")];
    const consultation = [
      slot("2026-09-04T10:00:00-03:00", "2026-09-04T11:00:00-03:00"),
      slot("2026-09-04T09:30:00-03:00", "2026-09-04T10:30:00-03:00"),
    ];

    expect(select(basePlan, assessment, consultation, "compact")?.[1].slot.startAt).toContain("09:30");
    expect(select(basePlan, assessment, consultation.slice(0, 1), "compact")?.[1].slot.startAt).toContain("10:00");
    expect(select(basePlan, assessment, consultation, "flexible")?.[1].slot.startAt).toContain("09:30");
  });

  it("orders the latest candidates first", () => {
    const candidates = selectSchedulingPlanCandidates({
      plan: { ...basePlan, steps: [basePlan.steps[0]] },
      slotsByStep: new Map([["assessment", [
        slot("2026-09-04T09:00:00-03:00", "2026-09-04T09:30:00-03:00"),
        slot("2026-09-04T16:00:00-03:00", "2026-09-04T16:30:00-03:00"),
      ]]]),
      preference: "latest",
      offeredSignatures: new Set(),
      limit: 2,
    });

    expect(candidates[0][0].slot.startAt).toContain("16:00");
  });

  it("orders each plan step by its earliest time instead of minimizing cross-day span", () => {
    const candidates = selectSchedulingPlanCandidates({
      plan: { ...basePlan, constraints: [{ type: "ordered", before: "assessment", after: "consultation" }] },
      slotsByStep: new Map([
        ["assessment", [
          slot("2026-09-07T09:00:00-03:00", "2026-09-07T09:30:00-03:00"),
          slot("2026-09-07T18:30:00-03:00", "2026-09-07T19:00:00-03:00"),
        ]],
        ["consultation", [
          slot("2026-09-09T09:00:00-03:00", "2026-09-09T10:30:00-03:00"),
          slot("2026-09-09T14:00:00-03:00", "2026-09-09T15:30:00-03:00"),
        ]],
      ]),
      preference: "earliest",
      offeredSignatures: new Set(),
      limit: 2,
    });

    expect(candidates[0][0].slot.startAt).toContain("2026-09-07T09:00");
    expect(candidates[0][1].slot.startAt).toContain("2026-09-09T09:00");
  });

  it("orders candidates closest to the customer's preferred time", () => {
    const candidates = selectSchedulingPlanCandidates({
      plan: { ...basePlan, steps: [basePlan.steps[0]] },
      slotsByStep: new Map([["assessment", [
        slot("2026-09-04T09:00:00-03:00", "2026-09-04T09:30:00-03:00"),
        slot("2026-09-04T14:30:00-03:00", "2026-09-04T15:00:00-03:00"),
      ]]]),
      preference: "closest_to_time",
      preferredTime: "15:00",
      offeredSignatures: new Set(),
      limit: 2,
    });

    expect(candidates[0][0].slot.startAt).toContain("14:30");
  });

  it("uses configured-gap waste only as a ranking tie-breaker", () => {
    const roomy = { ...slot("2026-09-04T09:00:00-03:00", "2026-09-04T09:30:00-03:00"), gapWasteMinutes: 120 };
    const fitted = { ...slot("2026-09-04T11:00:00-03:00", "2026-09-04T11:30:00-03:00"), gapWasteMinutes: 0 };
    const candidates = selectSchedulingPlanCandidates({
      plan: { ...basePlan, steps: [basePlan.steps[0]] },
      slotsByStep: new Map([["assessment", [roomy, fitted]]]),
      preference: "fill_gap",
      offeredSignatures: new Set(),
      limit: 2,
    });

    expect(candidates[0][0].slot.startAt).toContain("11:00");
  });
});
