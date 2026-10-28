export function createCalendarFormatters(timezone: string) {
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone,
  });
  const date = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", timeZone: timezone,
  });
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: timezone,
  });
  const dayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", timeZone: "UTC",
  });
  const shortDate = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", timeZone: "UTC",
  });
  const monthTitle = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
  const weekStart = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  const weekEnd = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  function dateKey(value: string) {
    const parts = dayKey.formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  return {
    dateKey,
    dayLabel: (key: string) => dayLabel.format(new Date(`${key}T12:00:00Z`)),
    shortDate: (key: string) => shortDate.format(new Date(`${key}T12:00:00Z`)),
    monthTitle: (value: Date) => monthTitle.format(value),
    weekTitle: (start: Date, end: Date) => `${weekStart.format(start)} \u2013 ${weekEnd.format(end)}`,
    appointmentRange(startValue: string, endValue: string) {
      const start = new Date(startValue);
      const end = new Date(endValue);
      const sameDay = dateKey(startValue) === dateKey(endValue);
      const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
      const startDate = date.format(start);
      const endDate = date.format(end);
      const startTime = time.format(start);
      const endTime = time.format(end);
      const durationLabel = formatDuration(durationMinutes);
      return {
        dateLabel: sameDay ? startDate : `${startDate} ${startTime}`,
        timeLabel: sameDay ? `${startTime}\u2013${endTime}` : `\u2192 ${endDate} ${endTime}`,
        durationLabel,
        fullLabel: `${startDate} ${startTime} at\u00e9 ${endDate} ${endTime} (${durationLabel})`,
      };
    },
  };
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h${String(remainder).padStart(2, "0")}` : `${hours}h`;
}
