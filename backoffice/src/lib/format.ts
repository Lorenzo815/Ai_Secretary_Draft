const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const number = new Intl.NumberFormat("pt-BR");

export function formatDate(value: unknown) {
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateTime.format(date) : "—";
}

export function formatNumber(value: number) {
  return number.format(value);
}

/**
 * The Atlas cluster usage bar ("Data size: 89.57 MB / 512 MB"): data + indexes in binary units
 * (1 MB = 1,048,576 bytes), unlike Atlas's collection list, which uses decimal units (formatBytes).
 */
export function formatAtlasClusterMb(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

/** Same format as the MongoDB Atlas UI: decimal units (1 MB = 1,000,000 bytes), two decimals ("66.40 MB", "506.00 B"). */
export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "kB", "MB", "GB"];
  const index = Math.min(Math.max(Math.floor(Math.log10(bytes) / 3), 0), units.length - 1);
  return `${(bytes / 1000 ** index).toFixed(2)} ${units[index]}`;
}
