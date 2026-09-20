import { describe, expect, it } from "vitest";
import { isEmptyAvailabilityResult } from "./availability-result";

describe("availability result", () => {
  it("forces a final response after a successful empty slot search", () => {
    expect(isEmptyAvailabilityResult({
      executedTools: ["calendar.find_slots"],
      results: [{ ok: true, tool: "calendar.find_slots", candidates: [] }],
    })).toBe(true);
  });

  it("allows the agent to continue after candidates are found", () => {
    expect(isEmptyAvailabilityResult({
      executedTools: ["calendar.find_slots"],
      results: [{ ok: true, tool: "calendar.find_slots", candidates: [{ candidateId: "candidate-1" }] }],
    })).toBe(false);
  });

  it("does not treat operational failures as an empty successful search", () => {
    expect(isEmptyAvailabilityResult({
      executedTools: ["calendar.find_slots"],
      results: [{ ok: false, tool: "calendar.find_slots", type: "operational_error" }],
    })).toBe(false);
  });
});
