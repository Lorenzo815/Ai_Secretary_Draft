import { DateTime } from "luxon";
import type { SchedulingPlan } from "../../assistant/agent/contracts";

export interface PlanSlot {
  startAt: string;
  endAt: string;
  gapWasteMinutes?: number;
  label: string;
}

export type SchedulingPreference = "earliest" | "latest" | "compact" | "closest_to_time" | "fill_gap" | "flexible";

export interface PlanCandidateStep {
  stepKey: string;
  eventTypeKey: string;
  slot: PlanSlot;
}

export function selectSchedulingPlanCandidate(input: {
  plan: SchedulingPlan;
  slotsByStep: Map<string, PlanSlot[]>;
  preference: SchedulingPreference;
  offeredSignatures: Set<string>;
}) {
  return selectSchedulingPlanCandidates({ ...input, limit: 1 })[0] ?? null;
}

export function selectSchedulingPlanCandidates(input: {
  plan: SchedulingPlan;
  slotsByStep: Map<string, PlanSlot[]>;
  preference: SchedulingPreference;
  offeredSignatures: Set<string>;
  preferredTime?: string | null;
  limit: number;
}) {
  const candidates: PlanCandidateStep[][] = [];
  buildCandidates(input.plan, input.slotsByStep, 0, [], candidates, 10_000);
  const ranked = candidates
    .filter((candidate) => satisfiesConstraints(input.plan, candidate))
    .filter((candidate) => !input.offeredSignatures.has(candidateSignature(candidate)))
    .sort((first, second) => compareCandidates(first, second, input.preference, input.preferredTime));
  return selectDiverseCandidates(ranked, Math.min(Math.max(input.limit, 1), 5));
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
  return true;
}

function compareCandidates(
  first: PlanCandidateStep[],
  second: PlanCandidateStep[],
  preference: SchedulingPreference,
  preferredTime?: string | null,
) {
  const firstStart = Math.min(...first.map((step) => DateTime.fromISO(step.slot.startAt).toMillis()));
  const secondStart = Math.min(...second.map((step) => DateTime.fromISO(step.slot.startAt).toMillis()));
  if (preference === "earliest" || preference === "latest") {
    for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
      const firstStepStart = DateTime.fromISO(first[index].slot.startAt).toMillis();
      const secondStepStart = DateTime.fromISO(second[index].slot.startAt).toMillis();
      if (firstStepStart !== secondStepStart) {
        return preference === "earliest"
          ? firstStepStart - secondStepStart
          : secondStepStart - firstStepStart;
      }
    }
    return first.length - second.length;
  }
  if (preference === "closest_to_time" && preferredTime) {
    const [hour, minute] = preferredTime.split(":").map(Number);
    const preferredMinutes = hour * 60 + minute;
    const distance = (candidate: PlanCandidateStep[]) => candidate.reduce((total, step) => {
      const start = DateTime.fromISO(step.slot.startAt);
      return total + Math.abs(start.hour * 60 + start.minute - preferredMinutes);
    }, 0);
    return distance(first) - distance(second) || firstStart - secondStart;
  }
  if (preference === "fill_gap") {
    const waste = (candidate: PlanCandidateStep[]) => candidate.reduce(
      (total, step) => total + (step.slot.gapWasteMinutes ?? Number.MAX_SAFE_INTEGER / candidate.length),
      0,
    );
    return waste(first) - waste(second) || firstStart - secondStart;
  }
  if (preference === "compact") return spanMinutes(first) - spanMinutes(second) || firstStart - secondStart;
  const firstSpan = spanMinutes(first);
  const secondSpan = spanMinutes(second);
  return firstSpan - secondSpan || firstStart - secondStart;
}

function spanMinutes(candidate: PlanCandidateStep[]) {
  const starts = candidate.map((step) => DateTime.fromISO(step.slot.startAt).toMillis());
  const ends = candidate.map((step) => DateTime.fromISO(step.slot.endAt).toMillis());
  return (Math.max(...ends) - Math.min(...starts)) / 60_000;
}

function selectDiverseCandidates(candidates: PlanCandidateStep[][], limit: number) {
  if (candidates.length <= 1 || limit === 1) return candidates.slice(0, limit);
  const selected: PlanCandidateStep[][] = [];
  for (const candidate of candidates) {
    if (selected.length === 0 || selected.every((existing) => areMeaningfullyDistinct(existing, candidate))) {
      selected.push(candidate);
      if (selected.length === limit) return selected;
    }
  }
  for (const candidate of candidates) {
    if (!selected.includes(candidate)) selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}

function areMeaningfullyDistinct(first: PlanCandidateStep[], second: PlanCandidateStep[]) {
  const secondByStep = new Map(second.map((step) => [step.stepKey, step]));
  const comparable = first.flatMap((step) => {
    const other = secondByStep.get(step.stepKey);
    return other ? [{ first: step, second: other }] : [];
  });
  if (comparable.length === 0) return true;
  const requiredSeparation = Math.max(...comparable.map(({ first: step }) => (
    DateTime.fromISO(step.slot.endAt).diff(DateTime.fromISO(step.slot.startAt), "minutes").minutes
  )));
  const actualSeparation = Math.max(...comparable.map(({ first: firstStep, second: secondStep }) => (
    Math.abs(DateTime.fromISO(secondStep.slot.startAt).diff(DateTime.fromISO(firstStep.slot.startAt), "minutes").minutes)
  )));
  return actualSeparation >= requiredSeparation;
}