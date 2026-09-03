import "server-only";

import { createHash } from "crypto";
import type { Collection } from "mongodb";
import clientPromise from "../../mongodb";
import { isAssistantToolKey, type AssistantToolKey } from "../tools";
import type { AgentConfigurationDocument } from "./contracts";
import { createDefaultAgentConfiguration } from "./defaults";

const DB_NAME = "ai_secretary";
const COLLECTION_NAME = "assistant_agent_config";

async function getCollection(): Promise<Collection<AgentConfigurationDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AgentConfigurationDocument>(COLLECTION_NAME);
}

export async function getAgentConfiguration() {
  const collection = await getCollection();
  const existing = await collection.findOne({ _id: "active" });
  if (existing) {
    const enabledTools = migrateLegacyToolKeys(existing.enabledTools);
    if (enabledTools.join("|") === existing.enabledTools.join("|")) return existing;
    const migrated = withContentHash({
      ...existing,
      enabledTools,
      revision: existing.revision + 1,
      contentHash: "",
      updatedAt: new Date(),
      updatedBy: "system-migration",
    });
    const result = await collection.replaceOne({ _id: "active", revision: existing.revision }, migrated);
    return result.matchedCount > 0 ? migrated : (await collection.findOne({ _id: "active" })) ?? migrated;
  }

  const initial = withContentHash(createDefaultAgentConfiguration());
  await collection.updateOne(
    { _id: "active" },
    { $setOnInsert: initial },
    { upsert: true },
  );
  return (await collection.findOne({ _id: "active" })) ?? initial;
}

export async function updateAgentConfiguration(input: {
  expectedRevision: number;
  updatedBy: string;
  configuration: Omit<AgentConfigurationDocument, "_id" | "revision" | "contentHash" | "updatedAt" | "updatedBy">;
}) {
  validateConfiguration(input.configuration);
  const collection = await getCollection();
  const next = withContentHash({
    _id: "active" as const,
    ...input.configuration,
    revision: input.expectedRevision + 1,
    contentHash: "",
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  });
  const result = await collection.replaceOne(
    { _id: "active", revision: input.expectedRevision },
    next,
  );
  if (result.matchedCount === 0) {
    throw new Error("A configuração foi alterada por outra sessão. Recarregue antes de salvar.");
  }
  return next;
}

export async function updateAgentPaymentSettings(input: {
  pixKey: string;
  recipientName: string;
  signalAmountCents: number;
  updatedBy?: string;
}) {
  const current = await getAgentConfiguration();
  return updateAgentConfiguration({
    expectedRevision: current.revision,
    updatedBy: input.updatedBy ?? "settings",
    configuration: {
      ...withoutMetadata(current),
      payment: {
        pixKey: input.pixKey.trim().slice(0, 200),
        recipientName: input.recipientName.trim().slice(0, 200),
        signalAmountCents: input.signalAmountCents,
      },
    },
  });
}

export async function setAgentEnabled(enabled: boolean, updatedBy = "settings") {
  const current = await getAgentConfiguration();
  return updateAgentConfiguration({
    expectedRevision: current.revision,
    updatedBy,
    configuration: { ...withoutMetadata(current), enabled },
  });
}

function withoutMetadata(document: AgentConfigurationDocument) {
  return {
    enabled: document.enabled,
    identityPrompt: document.identityPrompt,
    conversationPolicy: document.conversationPolicy,
    offensePolicy: document.offensePolicy,
    handoffPolicy: document.handoffPolicy,
    knowledge: document.knowledge,
    dataCollectionRules: document.dataCollectionRules,
    schedulingPlans: document.schedulingPlans,
    enabledTools: document.enabledTools,
    loopPolicy: document.loopPolicy,
    payment: document.payment,
  };
}

function withContentHash(document: AgentConfigurationDocument) {
  const hashInput = withoutMetadata(document);
  return {
    ...document,
    contentHash: createHash("sha256").update(JSON.stringify(hashInput)).digest("hex"),
  };
}

function validateConfiguration(
  configuration: Omit<AgentConfigurationDocument, "_id" | "revision" | "contentHash" | "updatedAt" | "updatedBy">,
) {
  if (!configuration.identityPrompt.trim() || !configuration.conversationPolicy.trim()) {
    throw new Error("Identidade e política de conversa são obrigatórias.");
  }
  if (!configuration.enabledTools.every(isAssistantToolKey)) {
    throw new Error("A configuração contém uma ferramenta desconhecida.");
  }
  if (new Set(configuration.dataCollectionRules.map((rule) => rule.fieldKey)).size !== configuration.dataCollectionRules.length) {
    throw new Error("Campos de coleta não podem ser duplicados.");
  }
  if (new Set(configuration.schedulingPlans.map((plan) => plan.key)).size !== configuration.schedulingPlans.length) {
    throw new Error("Planos de agenda não podem ter chaves duplicadas.");
  }
  for (const plan of configuration.schedulingPlans) {
    const steps = new Set(plan.steps.map((step) => step.key));
    if (!plan.key.trim() || !plan.name.trim() || steps.size !== plan.steps.length || plan.steps.length === 0) {
      throw new Error("Cada plano de agenda precisa de chave, nome e etapas únicas.");
    }
    for (const constraint of plan.constraints) {
      const referenced = constraint.type === "ordered"
        ? [constraint.before, constraint.after]
        : constraint.type === "gap"
          ? [constraint.from, constraint.to]
          : constraint.steps;
      if (referenced.some((step) => !steps.has(step))) {
        throw new Error(`O plano ${plan.key} contém uma restrição para uma etapa inexistente.`);
      }
    }
  }
  const loop = configuration.loopPolicy;
  if (
    !Number.isInteger(loop.maxModelIterations) || loop.maxModelIterations < 2 || loop.maxModelIterations > 10 ||
    !Number.isInteger(loop.maxToolExecutions) || loop.maxToolExecutions < 1 || loop.maxToolExecutions > 8 ||
    !Number.isInteger(loop.maxMutations) || loop.maxMutations < 0 || loop.maxMutations > 2 ||
    !Number.isInteger(loop.maxRepeatedInvalidCalls) || loop.maxRepeatedInvalidCalls < 0 || loop.maxRepeatedInvalidCalls > 3
  ) {
    throw new Error("Limites do loop do agente são inválidos.");
  }
  if (!Number.isInteger(configuration.payment.signalAmountCents) || configuration.payment.signalAmountCents < 100 || configuration.payment.signalAmountCents > 1_000_000) {
    throw new Error("O valor do sinal deve estar entre R$ 1,00 e R$ 10.000,00.");
  }
}

function migrateLegacyToolKeys(keys: readonly string[]) {
  const migrated = new Set<AssistantToolKey>();
  for (const key of keys) {
    if (key === "calendar.find_first_visit_option") migrated.add("calendar.find_plan_option");
    else if (key === "calendar.book_first_visit") migrated.add("calendar.book_plan_option");
    else if (isAssistantToolKey(key)) migrated.add(key);
  }
  return [...migrated];
}