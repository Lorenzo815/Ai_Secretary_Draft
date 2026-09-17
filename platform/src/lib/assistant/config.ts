import "server-only";

export function getAssistantConfig() {
  return {
    debounceMs: readPositiveInteger("ASSISTANT_DEBOUNCE_MS", 8_000),
    leaseMs: readPositiveInteger("ASSISTANT_LEASE_MS", 240_000),
    recentMessageLimit: readPositiveInteger("ASSISTANT_CONTEXT_MESSAGE_LIMIT", 40),
  };
}

function readPositiveInteger(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}