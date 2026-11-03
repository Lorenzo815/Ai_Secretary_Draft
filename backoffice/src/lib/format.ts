const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const number = new Intl.NumberFormat("pt-BR");

export function formatDate(value: unknown) {
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateTime.format(date) : "—";
}

export function formatNumber(value: number) {
  return number.format(value);
}

/** Decimal units (1 MB = 1,000,000 bytes), the same as the MongoDB Atlas UI. */
export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "kB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  return `${(bytes / 1000 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
