import "server-only";

import { createHash } from "crypto";
import type { Collection } from "mongodb";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";

export interface LeadQualificationConfigurationDocument {
  _id: "active";
  revision: number;
  contentHash: string;
  enabled: boolean;
  prompt: string;
  maxCompletionTokens: number;
  updatedAt: Date;
  updatedBy: string;
}

const DEFAULT_PROMPT = `Você é um analista de operações comerciais de uma clínica particular. Produza uma análise descritiva para revisão humana, nunca uma decisão de acesso, prioridade clínica, elegibilidade ou tratamento diferencial.

- Diferencie fatos, sinais explícitos e estimativas. Não invente evidências.
- Não use bairro como proxy socioeconômica. Cidade só pode influenciar pela logística objetiva.
- Profissão, idade e faixa salarial de mercado são aproximações e nunca comprovam renda, patrimônio, classe social ou capacidade de pagamento.
- A prontidão comercial deve usar somente sinais explícitos da conversa.
- Se ainda não houver intenção explícita, mantenha os sinais como unknown e use confiança conservadora.
- A distância usa o centro de Ponta Grossa/PR como referência, não o endereço exato da clínica.
- recommendedApproach deve orientar uma conversa respeitosa, sem pressão, urgência artificial ou promessa clínica.
- Escreva em português brasileiro de forma concisa, específica e auditável.`;

async function getCollection(): Promise<Collection<LeadQualificationConfigurationDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<LeadQualificationConfigurationDocument>("lead_qualification_config");
}

export async function getLeadQualificationConfiguration() {
  const collection = await getCollection();
  const existing = await collection.findOne({ _id: "active" });
  if (existing) return existing;
  const initial = withHash({
    _id: "active",
    revision: 1,
    contentHash: "",
    enabled: true,
    prompt: DEFAULT_PROMPT,
    maxCompletionTokens: 4_096,
    updatedAt: new Date(),
    updatedBy: "system",
  });
  await collection.updateOne({ _id: "active" }, { $setOnInsert: initial }, { upsert: true });
  return (await collection.findOne({ _id: "active" })) ?? initial;
}

export async function updateLeadQualificationConfiguration(input: {
  expectedRevision: number;
  enabled: boolean;
  prompt: string;
  maxCompletionTokens: number;
  updatedBy: string;
}) {
  if (!input.prompt.trim()) throw new Error("O prompt de qualificação é obrigatório.");
  if (!Number.isInteger(input.maxCompletionTokens) || input.maxCompletionTokens < 512 || input.maxCompletionTokens > 16_384) {
    throw new Error("O limite de tokens da qualificação é inválido.");
  }
  const next = withHash({
    _id: "active",
    revision: input.expectedRevision + 1,
    contentHash: "",
    enabled: input.enabled,
    prompt: input.prompt.trim().slice(0, 30_000),
    maxCompletionTokens: input.maxCompletionTokens,
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  });
  const result = await (await getCollection()).replaceOne(
    { _id: "active", revision: input.expectedRevision },
    next,
  );
  if (result.matchedCount === 0) throw new Error("A configuração de qualificação foi alterada. Recarregue antes de salvar.");
  return next;
}

function withHash(configuration: LeadQualificationConfigurationDocument) {
  const content = {
    _id: configuration._id,
    revision: configuration.revision,
    enabled: configuration.enabled,
    prompt: configuration.prompt,
    maxCompletionTokens: configuration.maxCompletionTokens,
  };
  return {
    ...configuration,
    contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
}