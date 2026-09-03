import "server-only";

import { getModelConfig } from "../ai/model-config";

export function getAssistantConfig() {
  const model = getModelConfig();

  return {
    apiKey: model.apiKey,
    endpoint: model.endpoint,
    deployment: model.deployment,
    apiVersion: model.apiVersion,
    debounceMs: readPositiveInteger("ASSISTANT_DEBOUNCE_MS", 8_000),
    leaseMs: readPositiveInteger("ASSISTANT_LEASE_MS", 240_000),
    modelRequestTimeoutMs: model.requestTimeoutMs,
    recentMessageLimit: readPositiveInteger("ASSISTANT_CONTEXT_MESSAGE_LIMIT", 40),
  };
}

function readPositiveInteger(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}