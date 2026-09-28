export interface CalendarAccessWindow {
  type: "permission" | "blocker";
  startAt: Date;
  endAt: Date;
  resourceIds: string[];
}

export function getSlotAccessDecision<T extends CalendarAccessWindow>(
  events: T[],
  resourceId: string,
  slotStart: Date,
  slotEnd: Date,
) {
  const applicable = events.filter((event) => (
    event.resourceIds.length === 0 || event.resourceIds.includes(resourceId)
  ));
  const permissions = applicable
    .filter((event) => event.type === "permission" && event.endAt > slotStart && event.startAt < slotEnd)
    .sort((first, second) => first.startAt.getTime() - second.startAt.getTime());
  let coveredUntil = slotStart;
  for (const permission of permissions) {
    if (permission.startAt > coveredUntil) break;
    if (permission.endAt > coveredUntil) coveredUntil = permission.endAt;
    if (coveredUntil >= slotEnd) break;
  }
  const permitted = coveredUntil >= slotEnd;
  return {
    permitted,
    blocker: applicable.find((event) => (
      event.type === "blocker"
      && event.startAt < slotEnd
      && event.endAt > slotStart
    )) ?? null,
  };
}

export function isSlotAllowedByAccessEvents(
  events: CalendarAccessWindow[],
  resourceId: string,
  slotStart: Date,
  slotEnd: Date,
) {
  const decision = getSlotAccessDecision(events, resourceId, slotStart, slotEnd);
  return decision.permitted && !decision.blocker;
}
