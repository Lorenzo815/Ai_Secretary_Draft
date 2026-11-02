import "server-only";

import { ObjectId } from "mongodb";
import { audit } from "./audit";
import { decryptValue, encryptAiCredential } from "./crypto";
import { getDb } from "./mongodb";
import { LEGACY_COMPANY_ID } from "./platform-rules";
import { assertConfirmed } from "./risk";

// Oria-wide settings shared by every clinic. Same document as platform/src/lib/ai/provider-credentials.ts.
const CREDENTIALS = "ai_provider_credentials";
const GATEWAY = "https://ai-gateway.vercel.sh/v1";

interface GatewayDocument { _id: "vercel"; apiKey: unknown; updatedAt?: Date; updatedBy?: string }

async function storedGatewayKey() {
  const document = await (await getDb()).collection<GatewayDocument>(CREDENTIALS).findOne({ _id: "vercel" });
  if (!document) return null;
  return { document, apiKey: decryptValue(document.apiKey) };
}

export async function getGatewayKeyInfo() {
  const stored = await storedGatewayKey().catch((error: Error) => ({ error: error.message }));
  if (!stored) return { configured: false as const };
  if ("error" in stored) return { configured: true as const, error: stored.error };
  const { apiKey, document } = stored;
  return {
    configured: true as const,
    masked: `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`,
    length: apiKey.length,
    updatedAt: document.updatedAt ?? null,
    updatedBy: document.updatedBy ?? "",
  };
}

/** The Vercel team's AI Gateway credit balance, as seen with the stored key (the key never leaves the server). */
export async function getGatewayCredits() {
  const stored = await storedGatewayKey();
  if (!stored) throw new Error("Nenhuma chave do AI Gateway configurada.");
  return queryCredits(stored.apiKey);
}

async function queryCredits(apiKey: string) {
  const response = await fetch(`${GATEWAY}/credits`, {
    headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? `A Vercel recusou a chave (HTTP ${response.status}).`
      : `A Vercel respondeu HTTP ${response.status}.`);
  }
  const body = await response.json() as { balance?: number | string; total_spend?: number | string; total_used?: number | string; currency?: string };
  return {
    balance: Number(body.balance ?? NaN),
    totalSpend: Number(body.total_spend ?? body.total_used ?? NaN),
    currency: body.currency ?? "USD",
  };
}

/** Replaces the key every clinic uses. It is checked against Vercel before being saved. */
export async function replaceGatewayKey(actor: string, input: string, confirmation?: string) {
  const apiKey = input.trim();
  if (apiKey.length < 20 || apiKey.length > 500 || /\s/.test(apiKey)) throw new Error("A chave do Vercel AI Gateway é inválida.");
  if (!apiKey.startsWith("vck_")) {
    throw new Error("Use uma AI Gateway API key criada em Vercel → AI Gateway → API Keys (formato vck_...).");
  }
  const credits = await queryCredits(apiKey);
  assertConfirmed("PRODUCAO", confirmation,
    "Esta chave é usada por todas as clínicas: as respostas de IA passam a consumir os créditos da conta Vercel dona da nova chave.");
  const collection = (await getDb()).collection<GatewayDocument & { companyId: ObjectId }>(CREDENTIALS);
  const before = await collection.findOne({ _id: "vercel" });
  const next = {
    _id: "vercel" as const, apiKey: encryptAiCredential(apiKey), updatedAt: new Date(), updatedBy: `backoffice:${actor}`,
    companyId: new ObjectId(LEGACY_COMPANY_ID),
  };
  await collection.replaceOne({ _id: "vercel" }, next, { upsert: true });
  await audit({
    actor, action: "oria.ai-gateway-key", collection: CREDENTIALS, documentId: "vercel", before: before ?? undefined, after: next,
    detail: `nova chave ${apiKey.slice(0, 4)}…${apiKey.slice(-4)}; saldo ${credits.balance} ${credits.currency}`,
  });
  return credits;
}
