import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { Collection } from "mongodb";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";
const COLLECTION = "ai_provider_credentials";

interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

interface ProviderCredentialDocument {
  _id: "vercel";
  apiKey: EncryptedSecret;
  updatedAt: Date;
  updatedBy: string;
}

export interface VercelGatewayCredential {
  apiKey: string;
  source: "environment" | "database";
  kind: "api_key" | "oidc" | "unknown";
}

async function getCollection(): Promise<Collection<ProviderCredentialDocument>> {
  return (await clientPromise).db(DB_NAME).collection<ProviderCredentialDocument>(COLLECTION);
}

export async function getVercelGatewayCredential(): Promise<VercelGatewayCredential | null> {
  const environmentKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (environmentKey) return { apiKey: environmentKey, source: "environment", kind: classifyCredential(environmentKey) };
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (oidcToken) return { apiKey: oidcToken, source: "environment", kind: "oidc" };
  const stored = await (await getCollection()).findOne({ _id: "vercel" });
  if (!stored) return null;
  const apiKey = decryptSecret(stored.apiKey);
  return { apiKey, source: "database", kind: classifyCredential(apiKey) };
}

export async function getVercelGatewayCredentialStatus() {
  const environmentConfigured = Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
  const databaseConfigured = Boolean(await (await getCollection()).findOne({ _id: "vercel" }, { projection: { _id: 1 } }));
  const credential = environmentConfigured || databaseConfigured
    ? await getVercelGatewayCredential()
    : null;
  return {
    configured: environmentConfigured || databaseConfigured,
    source: environmentConfigured ? "environment" as const : databaseConfigured ? "database" as const : null,
    environmentConfigured,
    databaseConfigured,
    storageEncryptionConfigured: hasValidEncryptionKey(),
    credentialKind: credential?.kind ?? null,
  };
}

export async function saveVercelGatewayApiKey(apiKey: string, updatedBy: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 20 || normalized.length > 500 || /\s/.test(normalized)) {
    throw new Error("A chave do Vercel AI Gateway é inválida.");
  }
  if (classifyCredential(normalized) !== "api_key") {
    throw new Error("Use uma AI Gateway API key criada no painel da Vercel (formato vck_...). Personal Access Tokens e OIDC não devem ser armazenados aqui.");
  }
  await (await getCollection()).replaceOne(
    { _id: "vercel" },
    { apiKey: encryptSecret(normalized), updatedAt: new Date(), updatedBy },
    { upsert: true },
  );
}

export async function clearStoredVercelGatewayApiKey() {
  await (await getCollection()).deleteOne({ _id: "vercel" });
}

function getEncryptionKey() {
  const encodedKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY
    ?? process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY não está configurada.");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY deve ter 32 bytes em Base64.");
  }
  return key;
}

function hasValidEncryptionKey() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

function encryptSecret(secret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSecret(secret: EncryptedSecret) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function classifyCredential(value: string): VercelGatewayCredential["kind"] {
  if (value.startsWith("vck_")) return "api_key";
  if (value.split(".").length === 3) return "oidc";
  return "unknown";
}