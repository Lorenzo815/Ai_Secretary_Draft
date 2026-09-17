import "server-only";

import { AI_TASK_KEYS, getAiProviderConfiguration, VERCEL_AUTO_PROVIDER, type AiTaskKey } from "./provider-config";
import { getProviderCredential } from "./providers/registry";
import type { AiProvider, ProviderCredential } from "./providers/types";

export interface ResolvedAiModel {
  provider: AiProvider;
  model: string;
  inferenceProvider: string | null;
  selectedProvider: AiProvider;
  credential: ProviderCredential | null;
}

export async function resolveAiModel(taskKey: string): Promise<ResolvedAiModel> {
  if (!isAiTaskKey(taskKey)) throw new Error(`A tarefa de IA ${taskKey} não possui configuração de modelo.`);
  const configuration = await getAiProviderConfiguration();
  const task = configuration.tasks[taskKey];
  const selectedProvider = configuration.activeProvider;

  return {
    provider: selectedProvider,
    model: selectedProvider === "vercel" ? task.vercelModel : task.azureModel,
    inferenceProvider: selectedProvider === "vercel" && task.vercelProvider !== VERCEL_AUTO_PROVIDER
      ? task.vercelProvider
      : null,
    selectedProvider,
    credential: await getProviderCredential(selectedProvider),
  };
}

function isAiTaskKey(value: string): value is AiTaskKey {
  return AI_TASK_KEYS.includes(value as AiTaskKey);
}