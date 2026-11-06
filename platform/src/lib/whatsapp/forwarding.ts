import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { Binary, ObjectId, type Db } from "mongodb";
import { adminTransaction, ManagementError } from "../access/management";
import type { Principal } from "../access/contracts";
import { legacyCompanyId } from "../companies/ownership";
import { isCompanyOperational } from "../companies/status";
import { prepareCalendarDelivery, sendCalendarDelivery } from "../calendar/forwarding";
import {
  adminCompanyId, assertTestAllowed, deliveryCollection, deliveryKind, ensureDeliveryIndexes, finishDelivery,
  forwardingDatabase, LEASE_MS, readForwardingStats, recordForwardingOutcome, requireAdminCompany, RETENTION_MS,
  validateEndpointList, type Delivery,
} from "../forwarding/store";
import { FORWARDING_ENDPOINT_LIMIT, type ForwardingEndpoint, type ForwardingSettings } from "./forwarding-contracts";
import { sendForwardedWebhook } from "./forwarding-http";
import { ForwardingRoutingError, resolveWhatsAppCompany, type WhatsAppCompanyBinding as Binding } from "./company-routing";
export { ForwardingRoutingError, resolveWhatsAppCompany as resolveForwardingCompany } from "./company-routing";

interface Configuration {
  _id: ObjectId;
  companyId: ObjectId;
  revision: number;
  endpoints: ForwardingEndpoint[];
  updatedAt: Date;
  updatedBy: ObjectId;
}

const configurationCollection = (db: Db) => db.collection<Configuration>("whatsapp_forwarding_config");

export function validateForwardingEndpoints(value: unknown): ForwardingEndpoint[] {
  return validateEndpointList(value, [], (_endpoint, base) => base);
}

export async function getForwardingSettings(principal: Principal): Promise<ForwardingSettings> {
  const db = await forwardingDatabase();
  const { scope } = await requireAdminCompany(db, principal);
  const [configuration, stats] = await Promise.all([
    configurationCollection(db).findOne({ _id: scope, companyId: scope }),
    readForwardingStats(db, scope, "whatsapp"),
  ]);
  return {
    revision: configuration?.revision ?? 0,
    endpoints: configuration?.endpoints ?? [],
    stats,
  };
}

export async function saveForwardingSettings(principal: Principal, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !["revision", "endpoints"].includes(key)) ||
    !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new ManagementError("Configuração inválida.");
  const endpoints = validateForwardingEndpoints(input.endpoints);
  await adminTransaction(principal, async (db, session) => {
    const scope = adminCompanyId(principal);
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

export async function enqueueWhatsAppForwarding(body: Uint8Array, signature: string): Promise<number> {
  const db = await forwardingDatabase();
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
  // Forwarding is optional: a payload we can't attribute to exactly one operational company is not
  // forwarded, but it must never stop the message itself from being processed.
  let scope: ObjectId;
  try {
    scope = resolveWhatsAppCompany(payload, bindings);
  } catch (error) {
    if (!(error instanceof ForwardingRoutingError)) throw error;
    console.warn("WhatsApp forwarding skipped.", { code: error.code, wabas });
    return 0;
  }
  if (!await isCompanyOperational(scope)) return 0;
  const configuration = await configurationCollection(db).findOne({ _id: scope, companyId: scope });
  const endpoints = configuration?.endpoints.filter(endpoint => endpoint.enabled) ?? [];
  if (!endpoints.length) return 0;
  await ensureDeliveryIndexes(db);
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

async function deliverClaimed(db: Db, delivery: Delivery) {
  const company = await db.collection("companies").findOne({ _id: delivery.companyId, status: "active" });
  if (deliveryKind(delivery) === "calendar") {
    const body = company ? await prepareCalendarDelivery(db, delivery) : null;
    if (!body) {
      await finishDelivery(db, delivery, null);
      return null;
    }
    const result = await sendCalendarDelivery(delivery, body);
    await finishDelivery(db, delivery, result);
    return result;
  }
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

/** Worker step: sends due WhatsApp and calendar deliveries, retrying with backoff. */
export async function processForwardingDeliveries() {
  const db = await forwardingDatabase();
  await ensureDeliveryIndexes(db);
  const now = new Date();
  const abandonedFilter = {
    status: "processing" as const, leaseUntil: { $lte: now },
    $expr: { $gte: ["$attempts", { $add: ["$maxRetries", 1] }] },
  };
  const abandoned = await deliveryCollection(db).find(abandonedFilter, { projection: { companyId: 1, kind: 1, isTest: 1 } }).toArray();
  await deliveryCollection(db).updateMany(abandonedFilter, {
    $set: { status: "failed", lastError: "A última tentativa perdeu a concessão; confirme o recebimento no destino.", updatedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS) },
    $unset: { body: "", signature: "", calendarEvent: "", leaseUntil: "", leaseToken: "" },
  });
  for (const delivery of abandoned) await recordForwardingOutcome(db, delivery, "failed", now);
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
  const scope = adminCompanyId(principal);
  const id = new ObjectId();
  await ensureDeliveryIndexes(await forwardingDatabase());
  await adminTransaction(principal, async (db, session) => {
    const configuration = await configurationCollection(db).findOne({ _id: scope, companyId: scope }, { session });
    const endpoint = configuration?.endpoints.find(item => item.id === endpointId);
    if (!endpoint) throw new ManagementError("Salve o destino antes de testar.", 409);
    await assertTestAllowed(db, scope, session);
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
  const db = await forwardingDatabase();
  const delivery = await deliveryCollection(db).findOne({ _id: id, companyId: scope });
  if (!delivery) throw new ManagementError("O teste não foi encontrado.", 500);
  const result = await deliverClaimed(db, delivery);
  return { result, settings: await getForwardingSettings(principal) };
}
