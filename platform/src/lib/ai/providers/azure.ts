import "server-only";

import { AzureOpenAI } from "openai";
import { getModelConfig, getModelRequestTimeoutMs } from "../model-config";
import type { AiProviderAdapter } from "./types";

export const azureProvider: AiProviderAdapter = {
  id: "azure",
  async getCredential() {
    const secret = process.env.AZURE_OPENAI_API_KEY?.trim();
    return secret ? { secret, source: "environment" } : null;
  },
  createClient(model, credential) {
    const config = getModelConfig(model);
    return new AzureOpenAI({
      apiKey: credential.secret,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion,
      deployment: config.deployment,
      maxRetries: 0,
      timeout: getModelRequestTimeoutMs(),
    });
  },
  async checkHealth(client, model) {
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply only OK." }],
      max_completion_tokens: 8,
    });
  },
};