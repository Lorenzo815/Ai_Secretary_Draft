import "server-only";

import { createHash } from "crypto";
import type OpenAI from "openai";
import { azureProvider } from "./azure";
import type { AiProvider, AiProviderAdapter, ProviderCredential } from "./types";
import { withModelRateLimitRetry } from "../retry";
import { probeStructuredOutputClient } from "../structured-output-probe";
import { vercelProvider } from "./vercel";

const adapters: Record<AiProvider, AiProviderAdapter> = {
  azure: azureProvider,
  vercel: vercelProvider,
};
const clients = new Map<string, OpenAI>();

export function getProviderAdapter(provider: AiProvider) {
  return adapters[provider];
}

export async function getProviderCredential(provider: AiProvider) {
  return getProviderAdapter(provider).getCredential();
}

export function getProviderClient(provider: AiProvider, model: string, credential: ProviderCredential) {
  const fingerprint = createHash("sha256").update(credential.secret).digest("hex").slice(0, 16);
  const cacheKey = `${provider}:${model}:${fingerprint}`;
  const existing = clients.get(cacheKey);
  if (existing) return existing;
  const client = getProviderAdapter(provider).createClient(model, credential);
  clients.set(cacheKey, client);
  return client;
}

export async function checkProviderHealth(
  provider: AiProvider,
  model: string,
  mode: "connection" | "model" = "connection",
  inferenceProvider?: string,
) {
  const startedAt = Date.now();
  const adapter = getProviderAdapter(provider);
  const credential = await adapter.getCredential();
  if (!credential) throw new Error(`A credencial do provedor ${provider} não está configurada.`);
  const client = getProviderClient(provider, model, credential);
  if (mode === "model") {
    await withModelRateLimitRetry(() => client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply only OK." }],
      max_completion_tokens: 8,
      ...(provider === "vercel" && inferenceProvider ? {
        providerOptions: { gateway: { only: [inferenceProvider] } },
      } : {}),
    }));
  } else {
    await withModelRateLimitRetry(() => adapter.checkHealth(client, model));
  }
  return {
    provider,
    model,
    mode,
    inferenceProvider: inferenceProvider ?? null,
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
}

export async function probeProviderStructuredOutput(
  provider: AiProvider,
  model: string,
  inferenceProvider?: string,
) {
  const adapter = getProviderAdapter(provider);
  const credential = await adapter.getCredential();
  if (!credential) throw new Error(`A credencial do provedor ${provider} não está configurada.`);
  const result = await probeStructuredOutputClient(
    getProviderClient(provider, model, credential),
    model,
    provider === "vercel" ? inferenceProvider : undefined,
  );
  return {
    provider,
    model,
    inferenceProvider: inferenceProvider ?? null,
    checkedAt: new Date().toISOString(),
    ...result,
  };
}