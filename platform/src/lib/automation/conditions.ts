import type { AgentCondition, AgentConditionGroup } from "../assistant/agent/contracts";

export function matchesConditions(facts: Record<string, unknown>, group: AgentConditionGroup) {
  const allMatch = !group.all || group.all.every((condition) => matchesCondition(facts, condition));
  const anyMatch = !group.any || group.any.length === 0 || group.any.some((condition) => matchesCondition(facts, condition));
  return allMatch && anyMatch;
}

function matchesCondition(facts: Record<string, unknown>, condition: AgentCondition) {
  const actual = readPath(facts, condition.field);
  if (condition.operator === "is_present") return actual !== undefined && actual !== null && actual !== "";
  if (condition.operator === "is_absent") return actual === undefined || actual === null || actual === "";
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "neq") return actual !== condition.value;
  if (condition.operator === "gte") return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
  return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
}

function readPath(value: Record<string, unknown>, path: string) {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}