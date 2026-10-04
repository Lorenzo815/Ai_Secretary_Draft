import { DateTime } from "luxon";

export interface EffectiveWindowAvailability {
  weekday: number;
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

export interface EffectiveWindowResource {
  id: string;
  weeklyAvailability: EffectiveWindowAvailability[];
}

export interface EffectiveWindowAccessEvent {
  type: "permission" | "blocker";
  startAt: string | Date;
  endAt: string | Date;
  resourceIds: string[];
}

export interface EffectiveDayInterval {
  startAt: string;
  endAt: string;
  startTime: string;
  endTime: string;
}

export function getEffectiveDayWindows(
  dateKey: string,
  timezone: string,
  resource: EffectiveWindowResource,
  accessEvents: EffectiveWindowAccessEvent[],
): EffectiveDayInterval[] {
  const dayStart = DateTime.fromISO(dateKey, { zone: timezone }).startOf("day");
  if (!dayStart.isValid) return [];
  const dayEnd = dayStart.plus({ days: 1 });
  const availability = resource.weeklyAvailability.find((item) => item.weekday === dayStart.weekday);
  if (!availability?.enabled) return [];

  const scheduledWindows = availability.intervals.flatMap((interval) => {
    const start = DateTime.fromISO(`${dateKey}T${interval.startTime}`, { zone: timezone });
    const end = DateTime.fromISO(`${dateKey}T${interval.endTime}`, { zone: timezone });
    return start.isValid && end.isValid && end > start
      ? [{ start: start.toMillis(), end: end.toMillis() }]
      : [];
  });
  const applicableEvents = accessEvents.filter((event) => (
    event.resourceIds.length === 0 || event.resourceIds.includes(resource.id)
  ));
  const permissionWindows = applicableEvents
    .filter((event) => event.type === "permission")
    .flatMap((event) => clampEventToDay(event, dayStart, dayEnd));
  const blockerWindows = mergeWindows(applicableEvents
    .filter((event) => event.type === "blocker")
    .flatMap((event) => clampEventToDay(event, dayStart, dayEnd)));

  const permittedSchedule = mergeWindows(scheduledWindows.flatMap((schedule) => (
    permissionWindows.flatMap((permission) => intersectWindows(schedule, permission))
  )));
  const effective = blockerWindows.reduce(
    (windows, blocker) => windows.flatMap((window) => subtractWindow(window, blocker)),
    permittedSchedule,
  );
  return effective.map((window) => {
    const start = DateTime.fromMillis(window.start, { zone: timezone });
    const end = DateTime.fromMillis(window.end, { zone: timezone });
    return {
      startAt: start.toUTC().toISO()!,
      endAt: end.toUTC().toISO()!,
      startTime: start.toFormat("HH:mm"),
      endTime: end.toFormat("HH:mm"),
    };
  });
}

interface NumericWindow {
  start: number;
  end: number;
}

function clampEventToDay(
  event: EffectiveWindowAccessEvent,
  dayStart: DateTime,
  dayEnd: DateTime,
): NumericWindow[] {
  const start = DateTime.fromJSDate(event.startAt instanceof Date ? event.startAt : new Date(event.startAt));
  const end = DateTime.fromJSDate(event.endAt instanceof Date ? event.endAt : new Date(event.endAt));
  const clampedStart = Math.max(start.toMillis(), dayStart.toMillis());
  const clampedEnd = Math.min(end.toMillis(), dayEnd.toMillis());
  return Number.isFinite(clampedStart) && Number.isFinite(clampedEnd) && clampedEnd > clampedStart
    ? [{ start: clampedStart, end: clampedEnd }]
    : [];
}

function intersectWindows(left: NumericWindow, right: NumericWindow): NumericWindow[] {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return end > start ? [{ start, end }] : [];
}

function subtractWindow(window: NumericWindow, blocker: NumericWindow): NumericWindow[] {
  if (blocker.end <= window.start || blocker.start >= window.end) return [window];
  return [
    ...(blocker.start > window.start ? [{ start: window.start, end: blocker.start }] : []),
    ...(blocker.end < window.end ? [{ start: blocker.end, end: window.end }] : []),
  ];
}

function mergeWindows(windows: NumericWindow[]): NumericWindow[] {
  const sorted = [...windows].sort((left, right) => left.start - right.start);
  const merged: NumericWindow[] = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (!previous || window.start > previous.end) {
      merged.push({ ...window });
    } else if (window.end > previous.end) {
      previous.end = window.end;
    }
  }
  return merged;
}
