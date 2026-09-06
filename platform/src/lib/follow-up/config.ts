import "server-only";

import { createHash } from "crypto";
import type { Collection } from "mongodb";
import clientPromise from "../mongodb";
import { DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS, DEFAULT_FOLLOW_UP_PROMPT } from "./instructions";

const DB_NAME = "ai_secretary";

export interface FollowUpConfigurationDocument {
  _id: "active";
  revision: number;
  contentHash: string;
  enabled: boolean;
  intervalMinutes: number;
  activeStartHour: number;
  activeEndHour: number;
  maxHoursSinceInbound: number;
  prompt: string;
  attemptInstructions: string[];
  updatedAt: Date;
  updatedBy: string;
}

async function getCollection(): Promise<Collection<FollowUpConfigurationDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FollowUpConfigurationDocument>("assistant_follow_up_config");
}

export async function getFollowUpConfiguration() {
  const collection = await getCollection();
  const existing = await collection.findOne({ _id: "active" });
  if (existing) {
    if (Array.isArray(existing.attemptInstructions)) return existing;
    const migrated = withHash({
      ...existing,
      revision: existing.revision + 1,
      attemptInstructions: DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS,
      updatedAt: new Date(),
      updatedBy: "system-migration",
    });
    const result = await collection.replaceOne({ _id: "active", revision: existing.revision }, migrated);
    return result.matchedCount === 1 ? migrated : (await collection.findOne({ _id: "active" })) ?? migrated;
  }
  const initial = withHash({
    _id: "active",
    revision: 1,
    contentHash: "",
    enabled: true,
    intervalMinutes: 120,
    activeStartHour: 8,
    activeEndHour: 20,
    maxHoursSinceInbound: 24,
    prompt: DEFAULT_FOLLOW_UP_PROMPT,
    attemptInstructions: DEFAULT_FOLLOW_UP_ATTEMPT_INSTRUCTIONS,
    updatedAt: new Date(),
    updatedBy: "system",
  });
  await collection.updateOne({ _id: "active" }, { $setOnInsert: initial }, { upsert: true });
  return (await collection.findOne({ _id: "active" })) ?? initial;
}

export async function updateFollowUpConfiguration(input: {
  expectedRevision: number;
  enabled: boolean;
  intervalMinutes: number;
  activeStartHour: number;
  activeEndHour: number;
  maxHoursSinceInbound: number;
  prompt: string;
  attemptInstructions: string[];
  updatedBy: string;
}) {
  validateFollowUpConfiguration(input);
  const next = withHash({
    _id: "active",
    revision: input.expectedRevision + 1,
    contentHash: "",
    enabled: input.enabled,
    intervalMinutes: input.intervalMinutes,
    activeStartHour: input.activeStartHour,
    activeEndHour: input.activeEndHour,
    maxHoursSinceInbound: input.maxHoursSinceInbound,
    prompt: input.prompt.trim().slice(0, 10_000),
    attemptInstructions: input.attemptInstructions.map((instruction) => instruction.trim().slice(0, 2_000)),
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  });
  const result = await (await getCollection()).replaceOne(
    { _id: "active", revision: input.expectedRevision },
    next,
  );
  if (result.matchedCount === 0) throw new Error("A configuração de follow-up foi alterada. Recarregue antes de salvar.");
  return next;
}

function validateFollowUpConfiguration(input: {
  expectedRevision: number;
  intervalMinutes: number;
  activeStartHour: number;
  activeEndHour: number;
  maxHoursSinceInbound: number;
  prompt: string;
  attemptInstructions: string[];
}) {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error("Revisão de follow-up inválida.");
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 2 || input.intervalMinutes > 1_440) {
    throw new Error("O intervalo de follow-up deve ficar entre 2 e 1440 minutos.");
  }
  if (!Number.isInteger(input.activeStartHour) || !Number.isInteger(input.activeEndHour) || input.activeStartHour < 0 || input.activeEndHour > 24 || input.activeStartHour >= input.activeEndHour) {
    throw new Error("A janela ativa de follow-up é inválida.");
  }
  if (!Number.isInteger(input.maxHoursSinceInbound) || input.maxHoursSinceInbound < 1 || input.maxHoursSinceInbound > 24) {
    throw new Error("A validade do follow-up deve ficar entre 1 e 24 horas.");
  }
  if (!input.prompt.trim()) throw new Error("As instruções de follow-up são obrigatórias.");
  if (!Array.isArray(input.attemptInstructions) || input.attemptInstructions.length > 12 || input.attemptInstructions.some((instruction) => typeof instruction !== "string")) {
    throw new Error("As instruções por tentativa são inválidas.");
  }
}

function withHash(configuration: FollowUpConfigurationDocument) {
  const content = {
    _id: configuration._id,
    revision: configuration.revision,
    enabled: configuration.enabled,
    intervalMinutes: configuration.intervalMinutes,
    activeStartHour: configuration.activeStartHour,
    activeEndHour: configuration.activeEndHour,
    maxHoursSinceInbound: configuration.maxHoursSinceInbound,
    prompt: configuration.prompt,
    attemptInstructions: configuration.attemptInstructions,
  };
  return {
    ...configuration,
    contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
}