import type { FlowTransitionInput } from "./flows";
import type { ToolCall } from "./tools";

export function canContinueImmediately(input: {
  transition: FlowTransitionInput;
  toolCalls: ToolCall[];
  allowedTransitions: string[];
  modelCallCount: number;
  maxModelCalls: number;
}) {
  return input.transition.action === "transition"
    && input.transition.continueImmediately === true
    && Boolean(input.transition.targetFlowKey)
    && input.toolCalls.length === 0
    && input.allowedTransitions.includes(input.transition.targetFlowKey ?? "")
    && input.modelCallCount < input.maxModelCalls;
}