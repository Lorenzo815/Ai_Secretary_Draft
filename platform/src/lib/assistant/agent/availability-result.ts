export function isEmptyAvailabilityResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return false;
  return results.some((result) => (
    result !== null
    && typeof result === "object"
    && (result as { ok?: unknown }).ok === true
    && (result as { tool?: unknown }).tool === "calendar.find_slots"
    && Array.isArray((result as { candidates?: unknown }).candidates)
    && (result as { candidates: unknown[] }).candidates.length === 0
  ));
}
