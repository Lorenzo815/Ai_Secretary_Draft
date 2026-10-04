import { DateTime } from "luxon";

export type AppointmentRecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface AppointmentRecurrenceInput {
  frequency: AppointmentRecurrenceFrequency;
  interval: number;
  endMode: "count" | "until";
  count?: number;
  untilDate?: string;
}

export function buildAppointmentRecurrenceStarts(
  startAt: string,
  recurrence: AppointmentRecurrenceInput,
  timezone: string,
) {
  const first = DateTime.fromISO(startAt, { zone: timezone, setZone: true });
  if (!first.isValid) throw new Error("Data inicial da recorrência inválida.");
  if (!["daily", "weekly", "monthly"].includes(recurrence.frequency)) {
    throw new Error("Frequência de recorrência inválida.");
  }
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1 || recurrence.interval > 30) {
    throw new Error("O intervalo da recorrência deve estar entre 1 e 30.");
  }

  const count = Number(recurrence.count);
  const until = recurrence.untilDate
    ? DateTime.fromISO(recurrence.untilDate, { zone: timezone }).endOf("day")
    : null;
  if (recurrence.endMode === "count" && (!Number.isInteger(count) || count < 2 || count > 366)) {
    throw new Error("A série deve ter entre 2 e 366 ocorrências.");
  }
  if (recurrence.endMode === "until" && (
    !until?.isValid
    || until < first
    || until > first.plus({ years: 2 }).endOf("day")
  )) {
    throw new Error("A data final da série deve ficar entre o início e os próximos dois anos.");
  }
  if (recurrence.endMode !== "count" && recurrence.endMode !== "until") {
    throw new Error("Forma de término da recorrência inválida.");
  }

  const starts: DateTime[] = [];
  for (let occurrenceIndex = 0; occurrenceIndex < 366; occurrenceIndex += 1) {
    if (recurrence.endMode === "count" && occurrenceIndex >= count) break;
    const next = addAppointmentRecurrenceInterval(
      first,
      recurrence.frequency,
      recurrence.interval * occurrenceIndex,
    );
    if (recurrence.endMode === "until" && until && next > until) break;
    starts.push(next);
  }
  if (recurrence.endMode === "until" && until) {
    const nextAfterLimit = addAppointmentRecurrenceInterval(
      first,
      recurrence.frequency,
      recurrence.interval * starts.length,
    );
    if (starts.length === 366 && nextAfterLimit <= until) {
      throw new Error("A série não pode ultrapassar 366 ocorrências.");
    }
  }
  if (starts.length < 2) throw new Error("A recorrência precisa gerar ao menos duas ocorrências.");
  return starts;
}

export function addAppointmentRecurrenceInterval(
  start: DateTime,
  frequency: AppointmentRecurrenceFrequency,
  amount: number,
) {
  if (frequency === "daily") return start.plus({ days: amount });
  if (frequency === "weekly") return start.plus({ weeks: amount });
  return start.plus({ months: amount });
}
