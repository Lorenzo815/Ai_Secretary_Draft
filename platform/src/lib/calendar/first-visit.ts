import { DateTime } from "luxon";

interface FirstVisitSlot {
  startAt: string;
  endAt: string;
}

export function getReferencedFirstVisitOptionId(notes: string[]) {
  return notes
    .map((note) => /^optionId=([a-f\d]{24})$/i.exec(note)?.[1])
    .find((optionId): optionId is string => Boolean(optionId));
}

export function isCurrentFirstVisitOption(optionId: string, activeOptionId?: string) {
  return Boolean(activeOptionId && optionId === activeOptionId);
}

export function selectFirstVisitCandidate<T extends FirstVisitSlot>(input: {
  bioimpedanceSlots: T[];
  consultationSlots: T[];
  preference: "together" | "separate";
  offeredPairs: Set<string>;
}) {
  return input.bioimpedanceSlots.flatMap((bioimpedance) => {
    const bioEnd = DateTime.fromISO(bioimpedance.endAt);
    return input.consultationSlots.flatMap((consultation) => {
      const consultationStart = DateTime.fromISO(consultation.startAt);
      if (bioEnd > consultationStart) return [];
      const sameDay = bioEnd.toISODate() === consultationStart.toISODate();
      const gapMinutes = consultationStart.diff(bioEnd, "minutes").minutes;
      if (input.preference === "together" && (!sameDay || gapMinutes !== 0)) return [];
      if (input.offeredPairs.has(`${bioimpedance.startAt}|${consultation.startAt}`)) return [];
      return [{ bioimpedance, consultation, gapMinutes }];
    });
  }).sort((first, second) => (
    input.preference === "together"
      ? DateTime.fromISO(first.bioimpedance.startAt).toMillis() - DateTime.fromISO(second.bioimpedance.startAt).toMillis()
      : first.gapMinutes - second.gapMinutes || DateTime.fromISO(first.bioimpedance.startAt).toMillis() - DateTime.fromISO(second.bioimpedance.startAt).toMillis()
  ))[0] ?? null;
}