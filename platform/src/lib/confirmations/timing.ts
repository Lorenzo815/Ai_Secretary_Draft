import { DateTime } from "luxon";

// When reminders go out (no database access). Times are computed in the clinic's timezone.

export interface ConfirmationTimingPolicy {
  firstSendHoursBefore: number;
  activeStartHour: number;
  activeEndHour: number;
  intervalMinutes: number;
  timezone: string;
}

/** The moment itself when inside the sending window, otherwise the start of the next window. */
export function windowStartAtOrAfter(moment: Date, policy: ConfirmationTimingPolicy) {
  const local = DateTime.fromJSDate(moment, { zone: "utc" }).setZone(policy.timezone);
  if (local.hour >= policy.activeStartHour && local.hour < policy.activeEndHour) return moment;
  const start = local.hour < policy.activeStartHour ? local.startOf("day") : local.plus({ days: 1 }).startOf("day");
  return start.set({ hour: policy.activeStartHour }).toUTC().toJSDate();
}

/** First reminder: the configured hours before the first event of the day, moved into the next window if outside. */
export function plannedFirstSend(firstStartAt: Date, policy: ConfirmationTimingPolicy) {
  return windowStartAtOrAfter(new Date(firstStartAt.getTime() - policy.firstSendHoursBefore * 3_600_000), policy);
}

/** The next reminder after one sent at `sentAt`, or null when it would only arrive after the event started. */
export function nextReminderAt(sentAt: Date, firstStartAt: Date, policy: ConfirmationTimingPolicy) {
  const candidate = windowStartAtOrAfter(new Date(sentAt.getTime() + policy.intervalMinutes * 60_000), policy);
  return candidate < firstStartAt ? candidate : null;
}

/** After the last reminder the patient has one interval to answer, never past the start of the event. */
export function replyDeadline(lastSentAt: Date, firstStartAt: Date, policy: Pick<ConfirmationTimingPolicy, "intervalMinutes">) {
  return new Date(Math.min(lastSentAt.getTime() + policy.intervalMinutes * 60_000, firstStartAt.getTime()));
}

export function clinicLocalDate(moment: Date, timezone: string) {
  return DateTime.fromJSDate(moment, { zone: "utc" }).setZone(timezone).toISODate()!;
}

/**
 * Booking confirmed by a deposit: "Confirmado" when no reminder process applies (task off) or when the first
 * event is already inside the reminder period; otherwise "A confirmar" and the reminders confirm attendance.
 */
export function confirmationStatusAfterPayment(input: {
  firstStartAt: Date;
  now: Date;
  task: { enabled: boolean; firstSendHoursBefore: number };
}): "confirmed" | "pending" {
  if (!input.task.enabled) return "confirmed";
  return input.firstStartAt.getTime() - input.now.getTime() <= input.task.firstSendHoursBefore * 3_600_000 ? "confirmed" : "pending";
}

/** Bookings made shortly before the first reminder get no reminders; deposits don't count as "recent". */
export function eligibleForReminders(
  appointment: { createdAt: Date; paymentRequestId?: unknown },
  firstSendAt: Date,
  skipRecentHours: number,
) {
  if (appointment.paymentRequestId || skipRecentHours === 0) return true;
  return appointment.createdAt.getTime() <= firstSendAt.getTime() - skipRecentHours * 3_600_000;
}
