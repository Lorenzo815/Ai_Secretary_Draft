import type OpenAI from "openai";

export const AI_PROVIDERS = ["vercel", "azure"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

export interface ProviderCredential {
  secret: string;
  source: string;
}

export interface AiProviderAdapter {
  id: AiProvider;
  getCredential(): Promise<ProviderCredential | null>;
  createClient(model: string, credential: ProviderCredential): OpenAI;
  checkHealth(client: OpenAI, model: string): Promise<void>;
}