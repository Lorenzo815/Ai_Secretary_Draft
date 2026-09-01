import "server-only";

const DEFAULT_ENDPOINT = "https://srlav-mjc10tpz-eastus2.cognitiveservices.azure.com/";
const DEFAULT_DEPLOYMENT = "gpt-5.4-mini";
const DEFAULT_API_VERSION = "2024-12-01-preview";

export function getAssistantConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("AZURE_OPENAI_API_KEY não está configurada.");

  return {
    apiKey,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? DEFAULT_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? DEFAULT_DEPLOYMENT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? DEFAULT_API_VERSION,
    debounceMs: readPositiveInteger("ASSISTANT_DEBOUNCE_MS", 8_000),
    leaseMs: readPositiveInteger("ASSISTANT_LEASE_MS", 240_000),
    modelRequestTimeoutMs: readPositiveInteger("ASSISTANT_MODEL_REQUEST_TIMEOUT_MS", 90_000),
    recentMessageLimit: readPositiveInteger("ASSISTANT_CONTEXT_MESSAGE_LIMIT", 40),
  };
}

export function getDebounceMs() {
  return readPositiveInteger("ASSISTANT_DEBOUNCE_MS", 8_000);
}

function readPositiveInteger(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}