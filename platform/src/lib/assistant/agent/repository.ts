import "server-only";

import { createHash } from "crypto";
import type { Collection } from "mongodb";
import clientPromise from "../../mongodb";
import { getCalendarSettings } from "../../calendar/calendar";
import { isAssistantToolKey, type AssistantToolKey } from "../tools";
import type { AgentConfigurationDocument } from "./contracts";
import { createDefaultAgentConfiguration, DEFAULT_JOURNEY_POLICY, DEFAULT_RESPONSE_STYLE } from "./defaults";

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
    const existingAuthorization = (existing as AgentConfigurationDocument & {
      bookableEventTypeKeys?: unknown;
    }).bookableEventTypeKeys;
    const initialEventTypeKeys = existingAuthorization === undefined
      ? (await getCalendarSettings()).eventTypes.map((eventType) => eventType.key)
      : [];
    const bookableEventTypeKeys = normalizeBookableEventTypeKeys(existingAuthorization, initialEventTypeKeys);
    const enabledTools = migrateLegacyToolKeys(existing.enabledTools);
    const toolGuidance = normalizeToolGuidance(existing.toolGuidance);
    const journeyPolicy = normalizeJourneyPolicy(existing.journeyPolicy);
    const responseStyle = normalizeResponseStyle(existing.responseStyle);
    const loopPolicy = normalizeLoopPolicy(existing.loopPolicy);
    const schedulingPlans = normalizeSchedulingPlans(existing.schedulingPlans);
    if (
      enabledTools.join("|") === existing.enabledTools.join("|") &&
      existing.toolGuidance !== undefined &&
      JSON.stringify(toolGuidance) === JSON.stringify(existing.toolGuidance) &&
      journeyPolicy === existing.journeyPolicy &&
      responseStyle === existing.responseStyle &&
      JSON.stringify(loopPolicy) === JSON.stringify(existing.loopPolicy) &&
      JSON.stringify(schedulingPlans) === JSON.stringify(existing.schedulingPlans) &&
      JSON.stringify(bookableEventTypeKeys) === JSON.stringify(existingAuthorization)
    ) return existing;
    const migrated = withContentHash({
      ...existing,
      enabledTools,
      toolGuidance,
      journeyPolicy,
      responseStyle,
      loopPolicy,
      schedulingPlans,
      bookableEventTypeKeys,
      revision: existing.revision + 1,
      contentHash: "",
      updatedAt: new Date(),
      updatedBy: "system-migration",
    });
    const result = await collection.replaceOne({ _id: "active", revision: existing.revision }, migrated);
    if (result.matchedCount > 0) return migrated;
    const concurrent = await collection.findOne({ _id: "active" });
    return concurrent
      ? {
          ...concurrent,
          enabledTools: migrateLegacyToolKeys(concurrent.enabledTools),
          toolGuidance: normalizeToolGuidance(concurrent.toolGuidance),
          journeyPolicy: normalizeJourneyPolicy(concurrent.journeyPolicy),
          responseStyle: normalizeResponseStyle(concurrent.responseStyle),
          loopPolicy: normalizeLoopPolicy(concurrent.loopPolicy),
          schedulingPlans: normalizeSchedulingPlans(concurrent.schedulingPlans),
          bookableEventTypeKeys: normalizeBookableEventTypeKeys(
            (concurrent as AgentConfigurationDocument & { bookableEventTypeKeys?: unknown }).bookableEventTypeKeys,
            initialEventTypeKeys,
          ),
        }
      : migrated;
  }

  const calendarSettings = await getCalendarSettings();
  const initial = withContentHash({
    ...createDefaultAgentConfiguration(),
    bookableEventTypeKeys: calendarSettings.eventTypes.map((eventType) => eventType.key),
  });
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
  const configuration = {
    ...input.configuration,
    toolGuidance: normalizeToolGuidance(input.configuration.toolGuidance),
  };
  const calendarSettings = await getCalendarSettings();
  validateConfiguration(configuration, new Set(calendarSettings.eventTypes.map((eventType) => eventType.key)));
  const collection = await getCollection();
  const next = withContentHash({
    _id: "active" as const,
    ...configuration,
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
    responseStyle: document.responseStyle,
    offensePolicy: document.offensePolicy,
    handoffPolicy: document.handoffPolicy,
    journeyPolicy: document.journeyPolicy,
    knowledge: document.knowledge,
    dataCollectionRules: document.dataCollectionRules,
    schedulingPlans: document.schedulingPlans,
    bookableEventTypeKeys: document.bookableEventTypeKeys,
    enabledTools: document.enabledTools,
    toolGuidance: document.toolGuidance ?? {},
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
  availableEventTypeKeys: Set<string>,
) {
  if (!configuration.identityPrompt.trim() || !configuration.conversationPolicy.trim() || !configuration.responseStyle.trim()) {
    throw new Error("Identidade, política de conversa e estilo de resposta são obrigatórios.");
  }
  if (configuration.responseStyle.length > 8_000) {
    throw new Error("O estilo de resposta deve ter entre 1 e 8.000 caracteres.");
  }
  if (!configuration.journeyPolicy.trim() || configuration.journeyPolicy.length > 8_000) {
    throw new Error("A política da jornada deve ter entre 1 e 8.000 caracteres.");
  }
  if (!configuration.enabledTools.every(isAssistantToolKey)) {
    throw new Error("A configuração contém uma ferramenta desconhecida.");
  }
  if (Object.entries(configuration.toolGuidance ?? {}).some(([key, guidance]) => !isAssistantToolKey(key) || typeof guidance !== "string" || guidance.length > 2_000)) {
    throw new Error("As orientações adicionais das ferramentas são inválidas.");
  }
  if (new Set(configuration.dataCollectionRules.map((rule) => rule.fieldKey)).size !== configuration.dataCollectionRules.length) {
    throw new Error("Campos de coleta não podem ser duplicados.");
  }
  if (new Set(configuration.schedulingPlans.map((plan) => plan.key)).size !== configuration.schedulingPlans.length) {
    throw new Error("Planos de agenda não podem ter chaves duplicadas.");
  }
  if (
    !Array.isArray(configuration.bookableEventTypeKeys) ||
    new Set(configuration.bookableEventTypeKeys).size !== configuration.bookableEventTypeKeys.length ||
    configuration.bookableEventTypeKeys.some((key) => typeof key !== "string" || !availableEventTypeKeys.has(key))
  ) {
    throw new Error("A seleção de tipos de evento autorizados para a IA é inválida ou está desatualizada.");
  }
  const bookableEventTypes = new Set(configuration.bookableEventTypeKeys);
  const blockedPlans = configuration.schedulingPlans.filter((plan) => (
    plan.enabled && plan.steps.some((step) => !bookableEventTypes.has(step.eventTypeKey))
  ));
  if (blockedPlans.length > 0) {
    throw new Error(`Autorize os tipos de evento usados pelos planos ativos ou desative os planos: ${blockedPlans.map((plan) => plan.name).join(", ")}.`);
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
    if (
      !Number.isInteger(plan.proposalExpiryMinutes) ||
      plan.proposalExpiryMinutes < 1 ||
      plan.proposalExpiryMinutes > 10_080 ||
      !Number.isInteger(plan.holdDurationMinutes) ||
      plan.holdDurationMinutes < 5 ||
      plan.holdDurationMinutes > 10_080
    ) {
      throw new Error(`O plano ${plan.key} deve ter expirações válidas de até 7 dias.`);
    }
  }
  const loop = configuration.loopPolicy;
  if (
    !Number.isInteger(loop.maxModelIterations) || loop.maxModelIterations < 2 || loop.maxModelIterations > 10 ||
    !Number.isInteger(loop.maxRepeatedInvalidCalls) || loop.maxRepeatedInvalidCalls < 0 || loop.maxRepeatedInvalidCalls > 3
  ) {
    throw new Error("Limites do loop do agente são inválidos.");
  }
  if (!Number.isInteger(configuration.payment.signalAmountCents) || configuration.payment.signalAmountCents < 100 || configuration.payment.signalAmountCents > 1_000_000) {
    throw new Error("O valor do sinal deve estar entre R$ 1,00 e R$ 10.000,00.");
  }
}

function normalizeJourneyPolicy(value: unknown) {
  return typeof value === "string" && value.trim() ? value : DEFAULT_JOURNEY_POLICY;
}

function normalizeResponseStyle(value: unknown) {
  return typeof value === "string" && value.trim() ? value : DEFAULT_RESPONSE_STYLE;
}

function normalizeLoopPolicy(value: AgentConfigurationDocument["loopPolicy"]) {
  return {
    maxModelIterations: value.maxModelIterations,
    maxRepeatedInvalidCalls: value.maxRepeatedInvalidCalls,
  };
}

function normalizeSchedulingPlans(plans: AgentConfigurationDocument["schedulingPlans"]) {
  return plans.map((plan) => ({
    ...plan,
    holdDurationMinutes: Number.isInteger(plan.holdDurationMinutes)
      ? plan.holdDurationMinutes
      : 48 * 60,
  }));
}

function normalizeBookableEventTypeKeys(value: unknown, fallback: string[]) {
  const keys = Array.isArray(value) ? value : fallback;
  return [...new Set(keys.filter((key): key is string => typeof key === "string" && key.trim().length > 0))];
}

function migrateLegacyToolKeys(keys: readonly string[]) {
  const migrated = new Set<AssistantToolKey>();
  for (const key of keys) {
    if (["calendar.find_first_visit_option", "calendar.find_plan_option", "calendar.list_appointments", "calendar.check_availability"].includes(key)) {
      migrated.add("calendar.find_slots");
    } else if (["calendar.book_first_visit", "calendar.book_plan_option", "calendar.book_appointment"].includes(key)) {
      migrated.add("calendar.book");
    } else if (key === "calendar.update_appointment") {
      migrated.add("calendar.reschedule");
    }
    else if (isAssistantToolKey(key)) migrated.add(key);
  }
  if (migrated.has("calendar.find_slots") && migrated.has("calendar.book")) {
    migrated.add("calendar.hold");
  }
  return [...migrated];
}

function normalizeToolGuidance(guidance: AgentConfigurationDocument["toolGuidance"] | undefined) {
  return Object.fromEntries(Object.entries(guidance ?? {}).flatMap(([key, value]) => (
    isAssistantToolKey(key) && typeof value === "string" && value.trim()
      ? [[key, value.trim().slice(0, 2_000)]]
      : []
  ))) as AgentConfigurationDocument["toolGuidance"];
}