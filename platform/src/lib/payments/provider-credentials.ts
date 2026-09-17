import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { Collection } from "mongodb";
import clientPromise from "../mongodb";

interface EncryptedSecret { ciphertext: string; iv: string; authTag: string }
interface MercadoPagoCredentialDocument {
  _id: "mercado_pago";
  accessToken: EncryptedSecret;
  webhookSecret: EncryptedSecret;
  updatedAt: Date;
  updatedBy: string;
}

export interface MercadoPagoCredential {
  accessToken: string;
  webhookSecret: string;
  source: "environment" | "database";
}

async function getCollection(): Promise<Collection<MercadoPagoCredentialDocument>> {
  return (await clientPromise).db("ai_secretary").collection("payment_provider_credentials");
}

export async function getMercadoPagoCredential(): Promise<MercadoPagoCredential | null> {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim();
  if (accessToken && webhookSecret) return { accessToken, webhookSecret, source: "environment" };
  const stored = await (await getCollection()).findOne({ _id: "mercado_pago" });
  if (!stored) return null;
  return {
    accessToken: decrypt(stored.accessToken),
    webhookSecret: decrypt(stored.webhookSecret),
    source: "database",
  };
}

export async function getMercadoPagoCredentialStatus() {
  const environmentConfigured = Boolean(
    process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim()
    && process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim(),
  );
  const databaseConfigured = Boolean(await (await getCollection()).findOne(
    { _id: "mercado_pago" },
    { projection: { _id: 1 } },
  ));
  return {
    configured: environmentConfigured || databaseConfigured,
    source: environmentConfigured ? "environment" as const : databaseConfigured ? "database" as const : null,
    environmentConfigured,
    databaseConfigured,
    storageEncryptionConfigured: hasEncryptionKey(),
  };
}

export async function saveMercadoPagoCredential(input: {
  accessToken: string;
  webhookSecret: string;
  updatedBy: string;
}) {
  const accessToken = input.accessToken.trim();
  const webhookSecret = input.webhookSecret.trim();
  if (accessToken.length < 20 || webhookSecret.length < 16 || /\s/.test(accessToken) || /\s/.test(webhookSecret)) {
    throw new Error("As credenciais do Mercado Pago são inválidas.");
  }
  await (await getCollection()).replaceOne(
    { _id: "mercado_pago" },
    {
      accessToken: encrypt(accessToken),
      webhookSecret: encrypt(webhookSecret),
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
    },
    { upsert: true },
  );
}

export async function clearStoredMercadoPagoCredential() {
  await (await getCollection()).deleteOne({ _id: "mercado_pago" });
}

function getEncryptionKey() {
  const encoded = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY
    ?? process.env.AI_CREDENTIALS_ENCRYPTION_KEY
    ?? process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("PAYMENT_CREDENTIALS_ENCRYPTION_KEY não está configurada.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("PAYMENT_CREDENTIALS_ENCRYPTION_KEY deve ter 32 bytes em Base64.");
  return key;
}

function hasEncryptionKey() {
  try { getEncryptionKey(); return true; } catch { return false; }
}

function encrypt(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decrypt(value: EncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}