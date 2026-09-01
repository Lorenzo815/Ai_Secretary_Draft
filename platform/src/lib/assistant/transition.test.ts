import { describe, expect, it } from "vitest";
import { canContinueImmediately } from "./transition";

const transition = {
  action: "transition" as const,
  continueImmediately: true,
  targetFlowKey: "commercial_information",
};

describe("immediate assistant transitions", () => {
  it("blocks a transition while a profile update tool is pending", () => {
    expect(canContinueImmediately({
      transition,
      toolCalls: [{ tool: "customer.update_profile", arguments: { profession: "Engenheiro" } }],
      allowedTransitions: ["commercial_information"],
      modelCallCount: 1,
      maxModelCalls: 2,
    })).toBe(false);
  });

  it("allows a tool-free transition to an authorized flow", () => {
    expect(canContinueImmediately({
      transition,
      toolCalls: [],
      allowedTransitions: ["commercial_information"],
      modelCallCount: 1,
      maxModelCalls: 2,
    })).toBe(true);
  });
});