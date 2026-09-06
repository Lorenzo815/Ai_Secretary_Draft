import { DateTime } from "luxon";

export interface FollowUpTimingPolicy {
  intervalMinutes: number;
  activeStartHour: number;
  activeEndHour: number;
  maxHoursSinceInbound: number;
  timezone: string;
}

export function getNextFollowUpAt(input: {
  from: Date;
  lastInboundAt: Date;
  policy: FollowUpTimingPolicy;
}) {
  const expiresAt = DateTime.fromJSDate(input.lastInboundAt, { zone: "utc" })
    .plus({ hours: input.policy.maxHoursSinceInbound });
  let candidate = DateTime.fromJSDate(input.from, { zone: "utc" })
    .setZone(input.policy.timezone)
    .plus({ minutes: input.policy.intervalMinutes });

  if (candidate.hour < input.policy.activeStartHour) {
    candidate = candidate.startOf("day").set({ hour: input.policy.activeStartHour });
  } else if (candidate.hour >= input.policy.activeEndHour) {
    candidate = candidate.plus({ days: 1 }).startOf("day").set({ hour: input.policy.activeStartHour });
  }

  return candidate.toUTC() < expiresAt ? candidate.toUTC().toJSDate() : null;
}

export function isWithinFollowUpWindow(now: Date, policy: FollowUpTimingPolicy) {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(policy.timezone);
  return local.hour >= policy.activeStartHour && local.hour < policy.activeEndHour;
}

export function getNextActiveWindowStart(now: Date, policy: FollowUpTimingPolicy) {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(policy.timezone);
  if (local.hour < policy.activeStartHour) {
    return local.startOf("day").set({ hour: policy.activeStartHour }).toUTC().toJSDate();
  }
  return local.plus({ days: 1 }).startOf("day").set({ hour: policy.activeStartHour }).toUTC().toJSDate();
}