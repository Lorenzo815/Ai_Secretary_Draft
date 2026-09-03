import { DateTime } from "luxon";
import type { SchedulingPlan } from "../../assistant/agent/contracts";

export interface PlanSlot {
  startAt: string;
  endAt: string;
  label: string;
}

export interface PlanCandidateStep {
  stepKey: string;
  eventTypeKey: string;
  slot: PlanSlot;
}

export function selectSchedulingPlanCandidate(input: {
  plan: SchedulingPlan;
  slotsByStep: Map<string, PlanSlot[]>;
  preference: "compact" | "flexible";
  offeredSignatures: Set<string>;
}) {
  const candidates: PlanCandidateStep[][] = [];
  buildCandidates(input.plan, input.slotsByStep, 0, [], candidates, 10_000);
  return candidates
    .filter((candidate) => satisfiesConstraints(input.plan, candidate, input.preference))
    .filter((candidate) => !input.offeredSignatures.has(candidateSignature(candidate)))
    .sort((first, second) => compareCandidates(first, second, input.preference))[0] ?? null;
}

export function candidateSignature(candidate: PlanCandidateStep[]) {
  return candidate.map((step) => `${step.stepKey}:${step.slot.startAt}`).join("|");
}

function buildCandidates(
  plan: SchedulingPlan,
  slotsByStep: Map<string, PlanSlot[]>,
  index: number,
  current: PlanCandidateStep[],
  candidates: PlanCandidateStep[][],
  maximum: number,
) {
  if (candidates.length >= maximum) return;
  if (index >= plan.steps.length) {
    candidates.push(current);
    return;
  }
  const step = plan.steps[index];
  const slots = slotsByStep.get(step.key) ?? [];
  if (!step.required) {
    buildCandidates(plan, slotsByStep, index + 1, current, candidates, maximum);
  }
  for (const slot of slots) {
    buildCandidates(
      plan,
      slotsByStep,
      index + 1,
      [...current, { stepKey: step.key, eventTypeKey: step.eventTypeKey, slot }],
      candidates,
      maximum,
    );
    if (candidates.length >= maximum) return;
  }
}

function satisfiesConstraints(
  plan: SchedulingPlan,
  candidate: PlanCandidateStep[],
  preference: "compact" | "flexible",
) {
  const byKey = new Map(candidate.map((step) => [step.stepKey, step]));
  for (const constraint of plan.constraints) {
    if (constraint.type === "same_day") {
      const dates = constraint.steps.flatMap((key) => {
        const step = byKey.get(key);
        return step ? [DateTime.fromISO(step.slot.startAt).toISODate()] : [];
      });
      if (new Set(dates).size > 1) return false;
      continue;
    }
    const fromKey = constraint.type === "ordered" ? constraint.before : constraint.from;
    const toKey = constraint.type === "ordered" ? constraint.after : constraint.to;
    const from = byKey.get(fromKey);
    const to = byKey.get(toKey);
    if (!from || !to) continue;
    const gap = DateTime.fromISO(to.slot.startAt).diff(DateTime.fromISO(from.slot.endAt), "minutes").minutes;
    if (constraint.type === "ordered" && gap < 0) return false;
    if (constraint.type === "gap" && (gap < constraint.minMinutes || gap > constraint.maxMinutes)) return false;
  }
  if (preference === "compact") {
    const ordered = plan.steps.flatMap((definition) => {
      const step = byKey.get(definition.key);
      return step ? [step] : [];
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const previousEnd = DateTime.fromISO(ordered[index - 1].slot.endAt);
      const currentStart = DateTime.fromISO(ordered[index].slot.startAt);
      if (previousEnd.toMillis() !== currentStart.toMillis()) return false;
    }
  }
  return true;
}

function compareCandidates(
  first: PlanCandidateStep[],
  second: PlanCandidateStep[],
  preference: "compact" | "flexible",
) {
  const firstStart = Math.min(...first.map((step) => DateTime.fromISO(step.slot.startAt).toMillis()));
  const secondStart = Math.min(...second.map((step) => DateTime.fromISO(step.slot.startAt).toMillis()));
  if (preference === "compact") return firstStart - secondStart;
  const firstSpan = spanMinutes(first);
  const secondSpan = spanMinutes(second);
  return firstSpan - secondSpan || firstStart - secondStart;
}

function spanMinutes(candidate: PlanCandidateStep[]) {
  const starts = candidate.map((step) => DateTime.fromISO(step.slot.startAt).toMillis());
  const ends = candidate.map((step) => DateTime.fromISO(step.slot.endAt).toMillis());
  return (Math.max(...ends) - Math.min(...starts)) / 60_000;
}