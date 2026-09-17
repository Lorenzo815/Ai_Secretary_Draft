import "server-only";

import OpenAI from "openai";
import { getModelRequestTimeoutMs } from "../model-config";
import { getVercelGatewayCredential } from "../provider-credentials";
import type { AiProviderAdapter } from "./types";

export const vercelProvider: AiProviderAdapter = {
  id: "vercel",
  async getCredential() {
    const credential = await getVercelGatewayCredential();
    return credential ? {
      secret: credential.apiKey,
      source: credential.kind ? `${credential.source}:${credential.kind}` : credential.source,
    } : null;
  },
  createClient(_model, credential) {
    return new OpenAI({
      apiKey: credential.secret,
      baseURL: "https://ai-gateway.vercel.sh/v1",
      maxRetries: 0,
      timeout: getModelRequestTimeoutMs(),
    });
  },
  async checkHealth(client) {
    await client.models.list();
  },
};