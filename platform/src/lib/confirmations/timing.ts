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

/** "Sem confirmação" must happen at least this long before the event, so the clinic can still offer the slot to someone else. */
export const UNCONFIRMED_MIN_LEAD_HOURS = 2;
const SLOT_MINUTES = 15;

export interface ConfirmationScheduleIssue {
  /** Clinic-local times "HH:mm" of the first and last affected event start in the range. */
  from: string;
  to: string;
  /** Reminders that fit before the event. */
  sends: number;
  /** Fewer reminders than configured, or all reminders but "Sem confirmação" too close to the event. */
  reason: "sends" | "lead";
}

/**
 * Simulates, with the worker's own rules, an event at every 15-minute time of the day. The window is the same every
 * day, so only the time of day matters; it runs on a fixed UTC day so the result doesn't depend on any timezone.
 * Returns the ranges of event times where the configuration can't send every reminder and still mark the event
 * "Sem confirmação" UNCONFIRMED_MIN_LEAD_HOURS before it.
 */
export function confirmationScheduleIssues(
  settings: Omit<ConfirmationTimingPolicy, "timezone"> & { maxAttempts: number },
): ConfirmationScheduleIssue[] {
  const policy: ConfirmationTimingPolicy = { ...settings, timezone: "UTC" };
  const issues: ConfirmationScheduleIssue[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_MINUTES) {
    const startAt = new Date(Date.UTC(2026, 0, 15, 0, minutes));
    const sends: Date[] = [];
    let next: Date | null = plannedFirstSend(startAt, policy);
    if (next >= startAt) next = null;
    while (next && sends.length < settings.maxAttempts) {
      sends.push(next);
      next = sends.length < settings.maxAttempts ? nextReminderAt(next, startAt, policy) : null;
    }
    const last = sends.at(-1);
    const reason = sends.length < settings.maxAttempts ? "sends" as const
      : last!.getTime() + settings.intervalMinutes * 60_000 > startAt.getTime() - UNCONFIRMED_MIN_LEAD_HOURS * 3_600_000 ? "lead" as const
        : null;
    if (!reason) continue;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const previous = issues.at(-1);
    if (previous && previous.reason === reason && previous.sends === sends.length && previous.to === slotBefore(time)) previous.to = time;
    else issues.push({ from: time, to: time, sends: sends.length, reason });
  }
  return issues;
}

function slotBefore(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = hours * 60 + minutes - SLOT_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** One sentence per affected range, for the settings screen and the save error. */
export function describeConfirmationScheduleIssues(issues: ConfirmationScheduleIssue[], maxAttempts: number) {
  return issues.map((issue) => {
    const range = issue.from === issue.to ? `às ${issue.from}` : `das ${issue.from} às ${issue.to}`;
    if (issue.reason === "lead") {
      return `Eventos ${range}: os ${maxAttempts} envios cabem, mas o evento ficaria “Sem confirmação” a menos de ${UNCONFIRMED_MIN_LEAD_HOURS} h do horário, sem tempo para um encaixe.`;
    }
    return issue.sends === 0
      ? `Eventos ${range}: nenhum envio cabe antes do horário.`
      : `Eventos ${range}: só ${issue.sends} de ${maxAttempts} envios cabem antes do horário.`;
  });
}
