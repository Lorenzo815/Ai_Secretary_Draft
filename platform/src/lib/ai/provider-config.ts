import "server-only";

import type { Collection } from "mongodb";
import clientPromise from "../mongodb";
import {
  getVercelGatewayCredentialStatus,
} from "./provider-credentials";
import { AI_PROVIDERS, type AiProvider } from "./providers/types";

export type { AiProvider } from "./providers/types";

const DB_NAME = "ai_secretary";
const COLLECTION = "ai_model_config";

export const AI_TASK_KEYS = ["customer_agent", "lead_qualification"] as const;
export type AiTaskKey = typeof AI_TASK_KEYS[number];
export const AZURE_MODELS = ["gpt-5.4", "gpt-5.4-mini"] as const;
export type AzureModel = typeof AZURE_MODELS[number];
export const VERCEL_AUTO_PROVIDER = "auto";
export const REASONING_EFFORTS = ["default", "low", "medium", "high"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export const MIN_COMPLETION_TOKENS = 512;
export const MAX_COMPLETION_TOKENS = 65_536;

export interface AiTaskModelConfiguration {
  vercelModel: string;
  vercelProvider: string;
  azureModel: AzureModel;
  maxCompletionTokens: number;
  reasoningEffort: ReasoningEffort;
}

export interface AiProviderConfigurationDocument {
  _id: "active";
  revision: number;
  activeProvider: AiProvider;
  preferredProvider?: AiProvider;
  azureAccessAuthorizedAt?: Date;
  tasks: Record<AiTaskKey, AiTaskModelConfiguration>;
  audioTranscription: { vercelModel: string };
  updatedAt: Date;
  updatedBy: string;
}

const DEFAULT_CONFIGURATION: AiProviderConfigurationDocument = {
  _id: "active",
  revision: 1,
  activeProvider: "vercel",
  tasks: {
    customer_agent: {
      vercelModel: "openai/gpt-5.4-mini",
      vercelProvider: VERCEL_AUTO_PROVIDER,
      azureModel: "gpt-5.4-mini",
      maxCompletionTokens: 32_768,
      reasoningEffort: "high",
    },
    lead_qualification: {
      vercelModel: "openai/gpt-5.4-mini",
      vercelProvider: VERCEL_AUTO_PROVIDER,
      azureModel: "gpt-5.4-mini",
      maxCompletionTokens: 8_192,
      reasoningEffort: "default",
    },
  },
  audioTranscription: { vercelModel: "openai/gpt-4o-mini-transcribe" },
  updatedAt: new Date(0),
  updatedBy: "system",
};

async function getCollection(): Promise<Collection<AiProviderConfigurationDocument>> {
  return (await clientPromise).db(DB_NAME).collection<AiProviderConfigurationDocument>(COLLECTION);
}

export async function getAiProviderConfiguration() {
  const collection = await getCollection();
  const existing = await collection.findOne({ _id: "active" });
  if (existing) return normalizeConfiguration(existing);
  const initial = { ...DEFAULT_CONFIGURATION, updatedAt: new Date() };
  await collection.updateOne({ _id: "active" }, { $setOnInsert: initial }, { upsert: true });
  return normalizeConfiguration((await collection.findOne({ _id: "active" })) ?? initial);
}

export async function updateAiProviderConfiguration(input: {
  expectedRevision: number;
  activeProvider: AiProvider;
  azureAccessAuthorized?: boolean;
  tasks: Record<AiTaskKey, {
    vercelModel: string;
    vercelProvider?: string;
    azureModel: string;
    maxCompletionTokens?: number;
    reasoningEffort?: string;
  }>;
  audioTranscription?: { vercelModel?: string };
  updatedBy: string;
}) {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("Revisão da configuração de modelos inválida.");
  }
  if (!AI_PROVIDERS.includes(input.activeProvider)) {
    throw new Error("Provedor de IA inválido.");
  }
  if (input.activeProvider === "azure" && !input.azureAccessAuthorized) {
    throw new Error("O acesso ao Azure exige autorização protegida.");
  }
  const nextTasks = Object.fromEntries(AI_TASK_KEYS.map((taskKey) => {
    const task = input.tasks?.[taskKey];
    const vercelModel = task?.vercelModel?.trim();
    if (!vercelModel || vercelModel.length > 200 || !vercelModel.includes("/")) {
      throw new Error(`Modelo Vercel inválido para ${taskKey}.`);
    }
    const vercelProvider = task?.vercelProvider?.trim() || VERCEL_AUTO_PROVIDER;
    if (vercelProvider !== VERCEL_AUTO_PROVIDER && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(vercelProvider)) {
      throw new Error(`Provedor Vercel inválido para ${taskKey}.`);
    }
    if (!isAzureModel(task?.azureModel)) {
      throw new Error(`O modelo Azure de ${taskKey} deve ser gpt-5.4 ou gpt-5.4-mini.`);
    }
    const maxCompletionTokens = task.maxCompletionTokens ?? DEFAULT_CONFIGURATION.tasks[taskKey].maxCompletionTokens;
    if (
      !Number.isInteger(maxCompletionTokens) ||
      maxCompletionTokens < MIN_COMPLETION_TOKENS ||
      maxCompletionTokens > MAX_COMPLETION_TOKENS
    ) {
      throw new Error(`O limite de saída de ${taskKey} deve ficar entre ${MIN_COMPLETION_TOKENS} e ${MAX_COMPLETION_TOKENS} tokens.`);
    }
    const reasoningEffort = task.reasoningEffort ?? DEFAULT_CONFIGURATION.tasks[taskKey].reasoningEffort;
    if (!isReasoningEffort(reasoningEffort)) {
      throw new Error(`O nível de raciocínio de ${taskKey} é inválido.`);
    }
    return [taskKey, {
      vercelModel,
      vercelProvider,
      azureModel: task.azureModel,
      maxCompletionTokens,
      reasoningEffort,
    }];
  })) as AiProviderConfigurationDocument["tasks"];
  const current = await getAiProviderConfiguration();
  const transcriptionModel = (
    input.audioTranscription?.vercelModel
    ?? current.audioTranscription.vercelModel
  ).trim();
  if (!transcriptionModel || transcriptionModel.length > 200 || !transcriptionModel.includes("/") || /\s/.test(transcriptionModel)) {
    throw new Error("O modelo Vercel para transcrição de áudio é inválido.");
  }
  const next: AiProviderConfigurationDocument = {
    _id: "active",
    revision: input.expectedRevision + 1,
    activeProvider: input.activeProvider,
    ...(input.activeProvider === "azure" ? { azureAccessAuthorizedAt: new Date() } : {}),
    tasks: nextTasks,
    audioTranscription: { vercelModel: transcriptionModel },
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  };
  const result = await (await getCollection()).replaceOne(
    { _id: "active", revision: input.expectedRevision },
    next,
  );
  if (result.matchedCount === 0) {
    throw new Error("A configuração de modelos foi alterada. Recarregue antes de salvar.");
  }
  return next;
}

export async function getAiProviderStatus() {
  const vercel = await getVercelGatewayCredentialStatus();
  return {
    vercelConfigured: vercel.configured,
    vercelCredentialSource: vercel.source,
    vercelEnvironmentConfigured: vercel.environmentConfigured,
    vercelDatabaseConfigured: vercel.databaseConfigured,
    credentialStorageConfigured: vercel.storageEncryptionConfigured,
    credentialKind: vercel.credentialKind,
    azureConfigured: Boolean(process.env.AZURE_OPENAI_API_KEY?.trim()),
  };
}

function normalizeConfiguration(value: AiProviderConfigurationDocument): AiProviderConfigurationDocument {
  const configuredProvider = value.activeProvider ?? value.preferredProvider ?? "vercel";
  const activeProvider = configuredProvider === "azure" && !value.azureAccessAuthorizedAt
    ? "vercel"
    : configuredProvider;
  const current = { ...value };
  delete current.preferredProvider;
  return {
    ...DEFAULT_CONFIGURATION,
    ...current,
    activeProvider,
    tasks: {
      customer_agent: { ...DEFAULT_CONFIGURATION.tasks.customer_agent, ...value.tasks?.customer_agent },
      lead_qualification: { ...DEFAULT_CONFIGURATION.tasks.lead_qualification, ...value.tasks?.lead_qualification },
    },
    audioTranscription: {
      ...DEFAULT_CONFIGURATION.audioTranscription,
      ...value.audioTranscription,
    },
  };
}

function isAzureModel(value: unknown): value is AzureModel {
  return typeof value === "string" && AZURE_MODELS.includes(value as AzureModel);
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}