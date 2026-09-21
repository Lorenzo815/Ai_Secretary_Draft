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
  const permitted = applicable.some((event) => (
    event.type === "permission"
    && event.startAt <= slotStart
    && event.endAt >= slotEnd
  ));
  const blocked = applicable.some((event) => (
    event.type === "blocker"
    && event.startAt < slotEnd
    && event.endAt > slotStart
  ));
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
