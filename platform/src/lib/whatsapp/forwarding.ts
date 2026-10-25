import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { Binary, ObjectId, type Db } from "mongodb";
import { getMongoClient } from "../mongodb";
import { adminTransaction, ManagementError } from "../access/management";
import type { Principal } from "../access/contracts";
import { legacyCompanyId } from "../companies/ownership";
import {
  FORWARDING_ENDPOINT_LIMIT, FORWARDING_MAX_RETRIES,
  type ForwardingDeliveryStatus, type ForwardingEndpoint, type ForwardingResult, type ForwardingSettings,
} from "./forwarding-contracts";
import { ForwardingAddressError, forwardingUrl, sendForwardedWebhook } from "./forwarding-http";

interface Configuration {
  _id: ObjectId;
  companyId: ObjectId;
  revision: number;
  endpoints: ForwardingEndpoint[];
  updatedAt: Date;
  updatedBy: ObjectId;
}

interface Delivery {
  _id: ObjectId;
  companyId: ObjectId;
  endpointId: string;
  endpointName: string;
  url: string;
  digest: string;
  body?: Binary;
  signature?: string;
  status: ForwardingDeliveryStatus;
  attempts: number;
  maxRetries: number;
  dueAt: Date;
  createdAt: Date;
  updatedAt: Date;
  leaseUntil?: Date;
  leaseToken?: string;
  expiresAt?: Date;
  lastStatus?: number | null;
  lastError?: string | null;
  isTest: boolean;
}

interface Binding {
  _id: string;
  companyId: ObjectId;
  wabaId?: string;
  phoneNumberId?: string;
  status: string;
}

export class ForwardingRoutingError extends Error {
  constructor(readonly code: "WHATSAPP_FORWARDING_COMPANY_UNRESOLVED" | "WHATSAPP_FORWARDING_MIXED_COMPANIES" | "WHATSAPP_FORWARDING_COMPANY_INACTIVE") {
    super(code);
  }
}

const configurationCollection = (db: Db) => db.collection<Configuration>("whatsapp_forwarding_config");
const deliveryCollection = (db: Db) => db.collection<Delivery>("whatsapp_forwarding_deliveries");
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const LEASE_MS = 30_000;
let indexes: Promise<unknown> | undefined;

async function database() {
  return (await getMongoClient()).db("ai_secretary");
}

async function ensureIndexes(db: Db) {
  if (!indexes) {
    indexes = Promise.all([
      deliveryCollection(db).createIndex({ companyId: 1, endpointId: 1, digest: 1 }, { unique: true }),
      deliveryCollection(db).createIndex({ status: 1, dueAt: 1 }),
      deliveryCollection(db).createIndex({ companyId: 1, createdAt: -1 }),
      deliveryCollection(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    void indexes.catch(() => { indexes = undefined; });
  }
  await indexes;
}

function companyId(principal: Principal) {
  if (!principal.isAdmin || !/^[a-f0-9]{24}$/i.test(principal.companyId)) {
    throw new ManagementError("Somente o administrador da empresa pode gerenciar os encaminhamentos.", 403);
  }
  return new ObjectId(principal.companyId);
}

export function validateForwardingEndpoints(value: unknown): ForwardingEndpoint[] {
  if (!Array.isArray(value) || value.length > FORWARDING_ENDPOINT_LIMIT) {
    throw new ManagementError(`Configure no máximo ${FORWARDING_ENDPOINT_LIMIT} destinos.`);
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ManagementError("Destino inválido.");
    const endpoint = item as Record<string, unknown>;
    if (Object.keys(endpoint).some(key => !["id", "name", "url", "enabled", "maxRetries"].includes(key)) ||
      typeof endpoint.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(endpoint.id) || ids.has(endpoint.id) ||
      typeof endpoint.name !== "string" || !endpoint.name.trim() || endpoint.name.trim().length > 80 ||
      typeof endpoint.url !== "string" || endpoint.url.length > 2048 || typeof endpoint.enabled !== "boolean" ||
      typeof endpoint.maxRetries !== "number" || !Number.isInteger(endpoint.maxRetries) ||
      endpoint.maxRetries < 0 || endpoint.maxRetries > FORWARDING_MAX_RETRIES) {
      throw new ManagementError(`Destino inválido. Use nome, URL HTTPS e de 0 a ${FORWARDING_MAX_RETRIES} novas tentativas.`);
    }
    let url: string;
    try { url = forwardingUrl(endpoint.url.trim()).href; }
    catch (error) {
      if (error instanceof ForwardingAddressError) throw new ManagementError(error.message);
      throw error;
    }
    if (urls.has(url)) throw new ManagementError("Não repita a mesma URL na empresa.");
    ids.add(endpoint.id);
    urls.add(url);
    return { id: endpoint.id, name: endpoint.name.trim(), url, enabled: endpoint.enabled, maxRetries: endpoint.maxRetries };
  });
}

export async function getForwardingSettings(principal: Principal): Promise<ForwardingSettings> {
  const scope = companyId(principal);
  const db = await database();
  const company = await db.collection("companies").findOne({ _id: scope, adminUserId: new ObjectId(principal.id), status: "active", accessControlVersion: 1 });
  if (!company) throw new ManagementError("Administração da empresa não autorizada.", 403);
  const [configuration, deliveries] = await Promise.all([
    configurationCollection(db).findOne({ _id: scope, companyId: scope }),
    deliveryCollection(db).find({ companyId: scope }).sort({ createdAt: -1 }).limit(25).toArray(),
  ]);
  return {
    revision: configuration?.revision ?? 0,
    endpoints: configuration?.endpoints ?? [],
    deliveries: deliveries.map(delivery => ({
      id: delivery._id.toHexString(), endpointId: delivery.endpointId, endpointName: delivery.endpointName,
      status: delivery.status, attempts: delivery.attempts, maxRetries: delivery.maxRetries,
      lastStatus: delivery.lastStatus ?? null, lastError: delivery.lastError ?? null,
      createdAt: delivery.createdAt.toISOString(),
      nextAttemptAt: delivery.status === "pending" ? delivery.dueAt.toISOString() : null,
      isTest: delivery.isTest,
    })),
  };
}

export async function saveForwardingSettings(principal: Principal, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !["revision", "endpoints"].includes(key)) ||
    !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new ManagementError("Configuração inválida.");
  const endpoints = validateForwardingEndpoints(input.endpoints);
  await adminTransaction(principal, async (db, session) => {
    const scope = companyId(principal);
    const collection = configurationCollection(db);
    const current = await collection.findOne({ _id: scope, companyId: scope }, { session });
    if ((current?.revision ?? 0) !== input.revision) throw new ManagementError("A configuração mudou. Recarregue antes de salvar.", 409);
    if (endpoints.some(endpoint => endpoint.enabled)) {
      const connection = await db.collection<Binding>("whatsapp_embedded_signup_connections").findOne({
        companyId: scope, status: { $in: ["operational", "connected"] },
        wabaId: { $type: "string", $ne: "" }, phoneNumberId: { $type: "string", $ne: "" },
      }, { session, projection: { _id: 1 } });
      const environmentBound = scope.equals(legacyCompanyId()) &&
        Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID && process.env.WHATSAPP_PHONE_NUMBER_ID);
      if (!connection && !environmentBound) {
        throw new ManagementError("Conecte o WhatsApp da empresa com WABA e Phone Number ID antes de ativar encaminhamentos.", 409);
      }
    }
    await collection.replaceOne({ _id: scope, companyId: scope }, {
      companyId: scope, revision: Number(input.revision) + 1,
      endpoints, updatedAt: new Date(), updatedBy: new ObjectId(principal.id),
    }, { upsert: !current, session });
  });
  return getForwardingSettings(principal);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function resolveForwardingCompany(payload: unknown, bindings: Binding[]): ObjectId {
  const object = record(payload);
  if (!object || object.object !== "whatsapp_business_account" || !Array.isArray(object.entry) || !object.entry.length) {
    throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_UNRESOLVED");
  }
  const owners = new Set<string>();
  for (const rawEntry of object.entry) {
    const entry = record(rawEntry);
    if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.changes) || !entry.changes.length) {
      throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_UNRESOLVED");
    }
    for (const rawChange of entry.changes) {
      const change = record(rawChange);
      const metadata = record(record(change?.value)?.metadata);
      const phone = metadata?.phone_number_id;
      const matches = bindings.filter(binding =>
        binding.companyId instanceof ObjectId && binding.wabaId === entry.id &&
        (typeof phone !== "string" || binding.phoneNumberId === phone),
      );
      const candidates = new Set(matches.map(binding => binding.companyId.toHexString()));
      if (entry.id === process.env.WHATSAPP_BUSINESS_ACCOUNT_ID &&
        (typeof phone !== "string" || phone === process.env.WHATSAPP_PHONE_NUMBER_ID)) {
        candidates.add(legacyCompanyId().toHexString());
      }
      if (candidates.size !== 1) throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_UNRESOLVED");
      for (const owner of candidates) owners.add(owner);
    }
  }
  if (owners.size !== 1) throw new ForwardingRoutingError("WHATSAPP_FORWARDING_MIXED_COMPANIES");
  return new ObjectId([...owners][0]);
}

export async function enqueueWhatsAppForwarding(body: Uint8Array, signature: string): Promise<number> {
  const db = await database();
  if (!await configurationCollection(db).findOne({ "endpoints.enabled": true }, { projection: { _id: 1 } })) return 0;
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(body).toString("utf8")); }
  catch { throw new ManagementError("JSON inválido."); }
  const object = record(payload);
  if (object?.object !== "whatsapp_business_account") return 0;
  if (Array.isArray(object.entry) && object.entry.length === 0) return 0;
  const wabas = Array.isArray(object.entry)
    ? object.entry.flatMap(entry => typeof record(entry)?.id === "string" ? [String(record(entry)?.id)] : [])
    : [];
  const bindings = await db.collection<Binding>("whatsapp_embedded_signup_connections").find({
    wabaId: { $in: wabas }, status: { $in: ["operational", "connected"] },
  }, { projection: { companyId: 1, wabaId: 1, phoneNumberId: 1, status: 1 } }).toArray();
  const scope = resolveForwardingCompany(payload, bindings);
  if (!await db.collection("companies").findOne({ _id: scope, status: "active" })) {
    throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_INACTIVE");
  }
  const configuration = await configurationCollection(db).findOne({ _id: scope, companyId: scope });
  const endpoints = configuration?.endpoints.filter(endpoint => endpoint.enabled) ?? [];
  if (!endpoints.length) return 0;
  await ensureIndexes(db);
  const digest = createHash("sha256").update(body).digest("hex");
  const now = new Date();
  await deliveryCollection(db).bulkWrite(endpoints.map(endpoint => ({
    updateOne: {
      filter: { companyId: scope, endpointId: endpoint.id, digest },
      update: { $setOnInsert: {
        _id: new ObjectId(), companyId: scope, endpointId: endpoint.id, endpointName: endpoint.name,
        url: endpoint.url, digest, body: new Binary(body), signature, isTest: false,
        status: "pending" as const, attempts: 0, maxRetries: endpoint.maxRetries, dueAt: now, createdAt: now, updatedAt: now,
      } },
      upsert: true,
    },
  })));
  return endpoints.length;
}

async function finishDelivery(db: Db, delivery: Delivery, result: ForwardingResult | null) {
  const now = new Date();
  const status: ForwardingDeliveryStatus = result === null ? "cancelled"
    : result.ok ? "delivered" : delivery.attempts > delivery.maxRetries ? "failed" : "pending";
  const terminal = status !== "pending";
  await deliveryCollection(db).updateOne({
    _id: delivery._id, companyId: delivery.companyId, status: "processing", leaseToken: delivery.leaseToken,
  }, {
    $set: {
      status, updatedAt: now, lastStatus: result?.status ?? null,
      lastError: result?.error ?? (result ? null : "Destino removido, alterado, desativado ou empresa indisponível."),
      ...(terminal ? { expiresAt: new Date(now.getTime() + RETENTION_MS) } : {
        dueAt: new Date(now.getTime() + Math.min(30_000 * 2 ** (delivery.attempts - 1), 60 * 60_000)),
      }),
    },
    $unset: { leaseUntil: "", leaseToken: "", ...(terminal ? { body: "", signature: "" } : {}) },
  });
}

async function deliverClaimed(db: Db, delivery: Delivery) {
  const company = await db.collection("companies").findOne({ _id: delivery.companyId, status: "active" });
  const configuration = await configurationCollection(db).findOne({ _id: delivery.companyId, companyId: delivery.companyId });
  const endpoint = configuration?.endpoints.find(item => item.id === delivery.endpointId &&
    (delivery.isTest || item.enabled) && item.url === delivery.url);
  if (!company || !endpoint || !delivery.body) {
    await finishDelivery(db, delivery, null);
    return null;
  }
  const result = await sendForwardedWebhook({
    url: delivery.url, body: delivery.body.value(), signature: delivery.signature,
    deliveryId: delivery._id.toHexString(), isTest: delivery.isTest,
  });
  await finishDelivery(db, delivery, result);
  return result;
}

export async function processForwardingDeliveries() {
  const db = await database();
  await ensureIndexes(db);
  const now = new Date();
  await deliveryCollection(db).updateMany({
    status: "processing", leaseUntil: { $lte: now },
    $expr: { $gte: ["$attempts", { $add: ["$maxRetries", 1] }] },
  }, {
    $set: { status: "failed", lastError: "A última tentativa perdeu a concessão; confirme o recebimento no destino.", updatedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS) },
    $unset: { body: "", signature: "", leaseUntil: "", leaseToken: "" },
  });
  const results = await Promise.all(Array.from({ length: FORWARDING_ENDPOINT_LIMIT }, async () => {
    const delivery = await deliveryCollection(db).findOneAndUpdate({
      $expr: { $lt: ["$attempts", { $add: ["$maxRetries", 1] }] },
      $or: [{ status: "pending", dueAt: { $lte: now } }, { status: "processing", leaseUntil: { $lte: now } }],
    }, {
      $set: { status: "processing", leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now },
      $inc: { attempts: 1 },
    }, { sort: { dueAt: 1 }, returnDocument: "after" });
    if (!delivery) return false;
    await deliverClaimed(db, delivery);
    return true;
  }));
  return results.filter(Boolean).length;
}

export async function testForwardingEndpoint(principal: Principal, endpointId: unknown) {
  if (typeof endpointId !== "string") throw new ManagementError("Selecione um destino salvo.");
  const scope = companyId(principal);
  const id = new ObjectId();
  await ensureIndexes(await database());
  await adminTransaction(principal, async (db, session) => {
    const configuration = await configurationCollection(db).findOne({ _id: scope, companyId: scope }, { session });
    const endpoint = configuration?.endpoints.find(item => item.id === endpointId);
    if (!endpoint) throw new ManagementError("Salve o destino antes de testar.", 409);
    const recent = await deliveryCollection(db).findOne({
      companyId: scope, isTest: true, createdAt: { $gt: new Date(Date.now() - 5_000) },
    }, { session });
    if (recent) throw new ManagementError("Aguarde 5 segundos entre os testes da empresa.", 429);
    const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    const secret = process.env.WHATSAPP_APP_SECRET;
    const signature = secret ? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` : undefined;
    const now = new Date();
    await deliveryCollection(db).insertOne({
      _id: id, companyId: scope, endpointId, endpointName: endpoint.name, url: endpoint.url,
      digest: id.toHexString(), body: new Binary(body), signature, isTest: true, status: "processing",
      attempts: 1, maxRetries: 0, dueAt: now, createdAt: now, updatedAt: now,
      leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS),
    }, { session });
  });
  const db = await database();
  const delivery = await deliveryCollection(db).findOne({ _id: id, companyId: scope });
  if (!delivery) throw new ManagementError("O teste não foi encontrado.", 500);
  const result = await deliverClaimed(db, delivery);
  return { result, settings: await getForwardingSettings(principal) };
}
