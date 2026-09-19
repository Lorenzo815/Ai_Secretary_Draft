import "server-only";

import type { Collection } from "mongodb";
import clientPromise from "../mongodb";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
const DB_NAME = "ai_secretary";
const COLLECTION_NAME = "whatsapp_embedded_signup_config";
const DEFAULT_GRAPH_VERSION = "v25.0";

export interface EmbeddedSignupConfiguration {
  _id: "active";
  appId: string;
  configurationId: string;
  graphVersion: string;
  updatedAt: Date | null;
}

const CONNECTIONS_COLLECTION_NAME = "whatsapp_embedded_signup_connections";
const WEBHOOK_EVENTS_COLLECTION_NAME = "whatsapp_coexistence_webhook_events";

async function getCollection(): Promise<Collection<EmbeddedSignupConfiguration>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<EmbeddedSignupConfiguration>(COLLECTION_NAME);
}

async function getConnectionsCollection(): Promise<Collection<EmbeddedSignupConnection>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<EmbeddedSignupConnection>(CONNECTIONS_COLLECTION_NAME);
}

export async function getEmbeddedSignupConfiguration(): Promise<EmbeddedSignupConfiguration> {
  return (await (await getCollection()).findOne({ _id: "active" })) ?? {
    _id: "active",
    appId: "",
    configurationId: "",
    graphVersion: DEFAULT_GRAPH_VERSION,
    updatedAt: null,
  };
}

interface EncryptedToken {
  ciphertext: string;
  iv: string;
  authTag: string;
}

interface EmbeddedSignupConnection {
  _id: string;
  appId: string;
  graphVersion: string;
  accessToken: EncryptedToken;
  status: "token_exchanged" | "connected" | "operational";
  wabaId?: string;
  phoneNumberId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmbeddedSignupPublicConnection {
  connectionId: string;
  status: "connected" | "operational";
  wabaId: string;
  phoneNumberId: string;
  updatedAt: Date;
}

export async function updateEmbeddedSignupConfiguration(input: {
  appId: string;
  configurationId: string;
}) {
  const appId = validateMetaId(input.appId, "App ID");
  const configurationId = validateMetaId(input.configurationId, "Configuration ID");
  const next: EmbeddedSignupConfiguration = {
    _id: "active",
    appId,
    configurationId,
    graphVersion: DEFAULT_GRAPH_VERSION,
    updatedAt: new Date(),
  };
  await (await getCollection()).replaceOne({ _id: "active" }, next, { upsert: true });
  return next;
}

export async function getEmbeddedSignupConnectionStatus(): Promise<EmbeddedSignupPublicConnection | null> {
  const connection = await (await getConnectionsCollection()).findOne(
    { status: { $in: ["operational", "connected"] } },
    { sort: { status: -1, updatedAt: -1 } },
  );
  if (!connection?.wabaId || !connection.phoneNumberId) return null;
  return {
    connectionId: connection._id,
    status: connection.status as "connected" | "operational",
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    updatedAt: connection.updatedAt,
  };
}

export async function exchangeEmbeddedSignupCode(code: string) {
  const normalizedCode = code.trim();
  if (normalizedCode.length < 20 || normalizedCode.length > 4096) {
    throw new Error("Código temporário da Meta inválido.");
  }

  const { configuration, appSecret } = await verifyEmbeddedSignupAppCredentials();

  const query = new URLSearchParams({
    client_id: configuration.appId,
    client_secret: appSecret,
    code: normalizedCode,
  });
  const response = await fetch(
    `https://graph.facebook.com/${configuration.graphVersion}/oauth/access_token?${query}`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  const result = await response.json() as {
    access_token?: string;
    error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
  };
  if (!response.ok || !result.access_token) {
    throw new Error(formatMetaError(result.error, "A Meta recusou a troca do código temporário."));
  }

  const now = new Date();
  const connectionId = randomUUID();
  await (await getConnectionsCollection()).insertOne({
    _id: connectionId,
    appId: configuration.appId,
    graphVersion: configuration.graphVersion,
    accessToken: encryptToken(result.access_token),
    status: "token_exchanged",
    createdAt: now,
    updatedAt: now,
  });
  return { connectionId };
}

export async function verifyEmbeddedSignupAppCredentials() {
  const configuration = await getEmbeddedSignupConfiguration();
  if (!configuration.appId) throw new Error("App ID da Meta não está configurado.");
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) throw new Error("WHATSAPP_APP_SECRET não está configurado.");
  const query = new URLSearchParams({
    client_id: configuration.appId,
    client_secret: appSecret,
    grant_type: "client_credentials",
  });
  const response = await fetch(
    `https://graph.facebook.com/${configuration.graphVersion}/oauth/access_token?${query}`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  const result = await response.json() as {
    access_token?: string;
    error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
  };
  if (!response.ok || !result.access_token) {
    throw new Error(formatMetaError(
      result.error,
      "O App Secret não foi aceito para o App ID configurado.",
    ));
  }
  return { configuration, appSecret };
}

function formatMetaError(
  error: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } | undefined,
  fallback: string,
) {
  const identifiers = [
    error?.code !== undefined ? `code ${error.code}` : undefined,
    error?.error_subcode !== undefined ? `subcode ${error.error_subcode}` : undefined,
    error?.fbtrace_id ? `trace ${error.fbtrace_id}` : undefined,
  ].filter(Boolean).join(", ");
  return `${error?.message ?? fallback}${identifiers ? ` (${identifiers})` : ""}`;
}

export async function finalizeEmbeddedSignupConnection(input: {
  connectionId: string;
  wabaId: string;
  phoneNumberId?: string;
}) {
  const connectionId = input.connectionId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
    throw new Error("Conexão temporária inválida.");
  }
  const wabaId = validateMetaId(input.wabaId, "WABA ID");
  const connections = await getConnectionsCollection();
  const connection = await connections.findOne({ _id: connectionId });
  if (!connection) throw new Error("Conexão temporária não encontrada.");
  if (connection.status === "connected" || connection.status === "operational") {
    return { connectionId, wabaId: connection.wabaId, phoneNumberId: connection.phoneNumberId };
  }

  const accessToken = decryptToken(connection.accessToken);
  const phoneNumberId = await resolveCoexistencePhoneNumber({
    graphVersion: connection.graphVersion,
    accessToken,
    wabaId,
    requestedPhoneNumberId: input.phoneNumberId,
  });
  const response = await fetch(
    `https://graph.facebook.com/${connection.graphVersion}/${wabaId}/subscribed_apps`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json() as {
    success?: boolean;
    error?: { message?: string };
  };
  if (!response.ok || result.success !== true) {
    throw new Error(result.error?.message ?? "A Meta recusou a assinatura dos webhooks.");
  }

  const updatedAt = new Date();
  await connections.updateOne(
    { _id: connectionId },
    { $set: { status: "connected", wabaId, phoneNumberId, updatedAt } },
  );
  return { connectionId, wabaId, phoneNumberId };
}

export interface EmbeddedSignupPhoneCandidate {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export async function recoverEmbeddedSignupConnection(input: {
  connectionId: string;
  phoneNumberId?: string;
}) {
  const connectionId = input.connectionId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
    throw new Error("Conexão temporária inválida.");
  }

  const connection = await (await getConnectionsCollection()).findOne({ _id: connectionId });
  if (!connection) throw new Error("Conexão temporária não encontrada.");
  if (
    (connection.status === "connected" || connection.status === "operational")
    && connection.wabaId
    && connection.phoneNumberId
  ) {
    return {
      connectionId,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
    };
  }

  const event = await (await getWebhookEventsCollection()).findOne(
    {
      field: "account_update",
      "value.event": "PARTNER_APP_INSTALLED",
      "value.waba_info.partner_app_id": connection.appId,
      receivedAt: { $gte: new Date(connection.createdAt.getTime() - 10 * 60_000) },
      processedAt: null,
    },
    { sort: { receivedAt: -1 } },
  );
  const candidates = event
    ? await resolveEligiblePhoneCandidates(connection, [event.wabaId])
    : await resolveEmbeddedSignupAssetsFromToken(connection);
  if (!candidates || candidates.length === 0) return null;
  const selected = input.phoneNumberId
    ? candidates.find(({ phoneNumberId }) => phoneNumberId === input.phoneNumberId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!selected) {
    if (input.phoneNumberId) {
      throw new Error("O telefone selecionado não pertence aos ativos autorizados pela Meta.");
    }
    return { selectionRequired: true as const, candidates };
  }

  const result = await finalizeEmbeddedSignupConnection({
    connectionId,
    wabaId: selected.wabaId,
    phoneNumberId: selected.phoneNumberId,
  });
  if (event) {
    await (await getWebhookEventsCollection()).updateOne(
      { _id: event._id },
      { $set: { processedAt: new Date() } },
    );
  }
  return result;
}

export async function activateEmbeddedSignupConnection(connectionId: string) {
  const connections = await getConnectionsCollection();
  const connection = await connections.findOne({ _id: connectionId });
  if (!connection?.wabaId || !connection.phoneNumberId || connection.status === "token_exchanged") {
    throw new Error("Conexão de coexistência ainda não está pronta.");
  }
  const updatedAt = new Date();
  await connections.updateMany(
    { _id: { $ne: connectionId }, status: "operational" },
    { $set: { status: "connected", updatedAt } },
  );
  await connections.updateOne(
    { _id: connectionId },
    { $set: { status: "operational", updatedAt } },
  );
  return {
    connectionId,
    status: "operational" as const,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
  };
}

export async function getOperationalEmbeddedSignupConfig() {
  const connection = await (await getConnectionsCollection()).findOne({ status: "operational" });
  if (!connection?.wabaId || !connection.phoneNumberId) return null;
  return {
    accessToken: decryptToken(connection.accessToken),
    phoneNumberId: connection.phoneNumberId,
    businessAccountId: connection.wabaId,
    graphVersion: connection.graphVersion,
  };
}

export async function isOperationalEmbeddedSignupPhoneNumber(phoneNumberId: string | undefined) {
  const connection = await (await getConnectionsCollection()).findOne({ status: "operational" });
  return connection ? phoneNumberId === connection.phoneNumberId : null;
}

async function resolveCoexistencePhoneNumber(input: {
  graphVersion: string;
  accessToken: string;
  wabaId: string;
  requestedPhoneNumberId?: string;
}) {
  const requestedPhoneNumberId = input.requestedPhoneNumberId
    ? validateMetaId(input.requestedPhoneNumberId, "Phone Number ID")
    : undefined;
  const query = new URLSearchParams({ fields: "id,is_on_biz_app,platform_type" });
  const response = await fetch(
    `https://graph.facebook.com/${input.graphVersion}/${input.wabaId}/phone_numbers?${query}`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json() as {
    data?: Array<{ id?: string; is_on_biz_app?: boolean; platform_type?: string }>;
    error?: { message?: string };
  };
  if (!response.ok || !result.data) {
    throw new Error(result.error?.message ?? "Não foi possível consultar os telefones do WABA.");
  }
  const phone = result.data.find((candidate) => (
    (!requestedPhoneNumberId || candidate.id === requestedPhoneNumberId)
    && candidate.is_on_biz_app === true
    && candidate.platform_type === "CLOUD_API"
  ));
  if (!phone?.id) {
    throw new Error("A Meta não confirmou um telefone elegível para coexistência neste WABA.");
  }
  return validateMetaId(phone.id, "Phone Number ID");
}

async function resolveEmbeddedSignupAssetsFromToken(
  connection: EmbeddedSignupConnection,
) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) throw new Error("WHATSAPP_APP_SECRET não está configurado.");
  const accessToken = decryptToken(connection.accessToken);
  const query = new URLSearchParams({
    input_token: accessToken,
    access_token: `${connection.appId}|${appSecret}`,
  });
  const response = await fetch(
    `https://graph.facebook.com/${connection.graphVersion}/debug_token?${query}`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  const result = await response.json() as {
    data?: {
      app_id?: string;
      is_valid?: boolean;
      granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
    };
    error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
  };
  if (!response.ok || !result.data) {
    throw new Error(formatMetaError(result.error, "Não foi possível consultar os ativos autorizados pela Meta."));
  }
  if (!result.data.is_valid || result.data.app_id !== connection.appId) {
    throw new Error("A Meta retornou um token inválido ou pertencente a outro aplicativo.");
  }

  const wabaIds = [...new Set(
    result.data.granular_scopes
      ?.filter(({ scope }) => (
        scope === "whatsapp_business_management"
        || scope === "whatsapp_business_messaging"
      ))
      .flatMap(({ target_ids }) => target_ids ?? [])
      .filter((id) => /^\d{5,30}$/.test(id))
      ?? [],
  )];
  if (wabaIds.length === 0) return null;
  return resolveEligiblePhoneCandidates(connection, wabaIds);
}

async function resolveEligiblePhoneCandidates(
  connection: EmbeddedSignupConnection,
  wabaIds: string[],
) {
  const accessToken = decryptToken(connection.accessToken);
  const eligibleAssets = new Map<string, EmbeddedSignupPhoneCandidate>();
  for (const wabaId of wabaIds) {
    const query = new URLSearchParams({
      fields: "id,display_phone_number,verified_name,is_on_biz_app,platform_type",
    });
    const phoneResponse = await fetch(
      `https://graph.facebook.com/${connection.graphVersion}/${wabaId}/phone_numbers?${query}`,
      {
        headers: { Authorization: "Bearer " + accessToken },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    const phoneResult = await phoneResponse.json() as {
      data?: Array<{
        id?: string;
        display_phone_number?: string;
        verified_name?: string;
        is_on_biz_app?: boolean;
        platform_type?: string;
      }>;
      error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
    };
    if (!phoneResponse.ok || !phoneResult.data) {
      throw new Error(formatMetaError(phoneResult.error, "Não foi possível consultar os telefones autorizados."));
    }
    for (const phone of phoneResult.data) {
      if (phone.id && phone.is_on_biz_app === true && phone.platform_type === "CLOUD_API") {
        const phoneNumberId = validateMetaId(phone.id, "Phone Number ID");
        eligibleAssets.set(`${wabaId}:${phoneNumberId}`, {
          wabaId,
          phoneNumberId,
          ...(phone.display_phone_number ? { displayPhoneNumber: phone.display_phone_number } : {}),
          ...(phone.verified_name ? { verifiedName: phone.verified_name } : {}),
        });
      }
    }
  }

  return [...eligibleAssets.values()];
}

function getTokenEncryptionKey() {
  const encodedKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!encodedKey) throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY não está configurada.");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em Base64.");
  return key;
}

function encryptToken(token: string): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptToken(token: EncryptedToken) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getTokenEncryptionKey(),
    Buffer.from(token.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(token.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(token.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function validateMetaId(value: string, label: string) {
  const normalized = value.trim();
  if (!/^\d{5,30}$/.test(normalized)) {
    throw new Error(`${label} deve conter apenas números.`);
  }
  return normalized;
}

interface CoexistenceWebhookEvent {
  _id: string;
  wabaId: string;
  field: string;
  value: object;
  receivedAt: Date;
  processedAt: Date | null;
}

export const COEXISTENCE_WEBHOOK_FIELDS = new Set([
  "account_update",
  "history",
  "smb_app_state_sync",
  "smb_message_echoes",
]);

async function getWebhookEventsCollection(): Promise<Collection<CoexistenceWebhookEvent>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CoexistenceWebhookEvent>(WEBHOOK_EVENTS_COLLECTION_NAME);
}

export async function captureCoexistenceWebhookEvent(input: {
  wabaId: string;
  field: string;
  value: object;
}) {
  if (!COEXISTENCE_WEBHOOK_FIELDS.has(input.field)) return false;
  const serialized = JSON.stringify({ wabaId: input.wabaId, field: input.field, value: input.value });
  const eventId = createHash("sha256").update(serialized).digest("hex");
  const result = await (await getWebhookEventsCollection()).updateOne(
    { _id: eventId },
    {
      $setOnInsert: {
        _id: eventId,
        wabaId: input.wabaId,
        field: input.field,
        value: input.value,
        receivedAt: new Date(),
        processedAt: null,
      },
    },
    { upsert: true },
  );
  return result.upsertedCount === 1;
}
