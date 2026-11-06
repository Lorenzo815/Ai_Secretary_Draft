import "server-only";

import { type Binary, type ClientSession, type Db, ObjectId } from "mongodb";
import { getMongoClient } from "../mongodb";
import { ManagementError } from "../access/management";
import type { Principal } from "../access/contracts";
import {
  FORWARDING_ENDPOINT_LIMIT, FORWARDING_MAX_RETRIES,
  type ForwardingDeliveryStatus, type ForwardingEndpoint, type ForwardingKind,
  type ForwardingResult, type ForwardingStats,
} from "../whatsapp/forwarding-contracts";
import { ForwardingAddressError, forwardingUrl } from "../whatsapp/forwarding-http";
import type { CalendarDeliveryEvent } from "../calendar/forwarding-events";

/** One message to one destination. WhatsApp and calendar forwarding share this queue and its retries. */
export interface Delivery {
  _id: ObjectId;
  companyId: ObjectId;
  /** Missing on WhatsApp deliveries queued before calendar forwarding existed. */
  kind?: ForwardingKind;
  endpointId: string;
  endpointName: string;
  url: string;
  digest: string;
  /** Exact bytes to send (WhatsApp payloads and tests). */
  body?: Binary;
  signature?: string;
  /** Calendar events: the payload, with the patient's data, is only built when sending. */
  calendarEvent?: CalendarDeliveryEvent;
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

interface StatsBucket {
  _id: string;
  companyId: ObjectId;
  kind: ForwardingKind;
  hour: Date;
  delivered?: number;
  failed?: number;
  expiresAt: Date;
}

export const RETENTION_MS = 7 * 24 * 60 * 60_000;
export const LEASE_MS = 30_000;
const HOUR_MS = 60 * 60_000;
const STATS_RETENTION_MS = 32 * 24 * HOUR_MS;

export async function forwardingDatabase() {
  return (await getMongoClient()).db("ai_secretary");
}

export const deliveryCollection = (db: Db) => db.collection<Delivery>("whatsapp_forwarding_deliveries");
const statsCollection = (db: Db) => db.collection<StatsBucket>("forwarding_stats");
export const deliveryKind = (delivery: Pick<Delivery, "kind">): ForwardingKind => delivery.kind ?? "whatsapp";

let deliveryIndexes: Promise<unknown> | undefined;
let statsIndexes: Promise<unknown> | undefined;

export async function ensureDeliveryIndexes(db: Db) {
  if (!deliveryIndexes) {
    deliveryIndexes = Promise.all([
      deliveryCollection(db).createIndex({ companyId: 1, endpointId: 1, digest: 1 }, { unique: true }),
      deliveryCollection(db).createIndex({ status: 1, dueAt: 1 }),
      deliveryCollection(db).createIndex({ companyId: 1, createdAt: -1 }),
      deliveryCollection(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    void deliveryIndexes.catch(() => { deliveryIndexes = undefined; });
  }
  await deliveryIndexes;
}

async function ensureStatsIndexes(db: Db) {
  if (!statsIndexes) {
    statsIndexes = Promise.all([
      statsCollection(db).createIndex({ companyId: 1, kind: 1, hour: 1 }),
      statsCollection(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    void statsIndexes.catch(() => { statsIndexes = undefined; });
  }
  await statsIndexes;
}

/** Counts final outcomes per hour, so the 24 h / 7 d / 30 d totals survive the 7-day delivery retention. */
export async function recordForwardingOutcome(db: Db, delivery: Delivery, status: ForwardingDeliveryStatus, at: Date) {
  if (delivery.isTest || (status !== "delivered" && status !== "failed")) return;
  try {
    await ensureStatsIndexes(db);
    const kind = deliveryKind(delivery);
    const hour = new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
    await statsCollection(db).updateOne(
      { _id: `${delivery.companyId.toHexString()}:${kind}:${hour.toISOString()}` },
      {
        $setOnInsert: { companyId: delivery.companyId, kind, hour, expiresAt: new Date(hour.getTime() + STATS_RETENTION_MS) },
        $inc: { [status]: 1 },
      },
      { upsert: true },
    );
  } catch (error) {
    // Counters are informative; a failure must never undo or retry a delivery.
    console.error("Forwarding stats update failed.", { errorType: error instanceof Error ? error.name : "Unknown" });
  }
}

/**
 * Real deliveries that ended (accepted or failed), per period. The delivery records themselves cover the 7 days
 * they are kept, exact and including what was sent before the counters existed; the hourly totals cover days 8–30.
 */
export async function readForwardingStats(db: Db, companyId: ObjectId, kind: ForwardingKind, now = new Date()): Promise<ForwardingStats> {
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);
  const retentionStart = ago(RETENTION_MS / HOUR_MS);
  // Hourly totals only for whole hours the delivery records no longer cover, so nothing is counted twice.
  const olderUntil = new Date(Math.floor(retentionStart.getTime() / HOUR_MS) * HOUR_MS);
  const [recent] = await deliveryCollection(db).aggregate<Record<string, number>>([
    { $match: {
      companyId, isTest: false, status: { $in: ["delivered", "failed"] },
      kind: kind === "whatsapp" ? { $ne: "calendar" } : kind,
      // Retries end within hours of creation; the index is on createdAt.
      createdAt: { $gte: new Date(retentionStart.getTime() - 24 * HOUR_MS) },
      updatedAt: { $gte: retentionStart },
    } },
    { $group: {
      _id: null,
      ...Object.fromEntries((["delivered", "failed"] as const).flatMap((status) => [
        [`${status}24`, { $sum: { $cond: [{ $and: [{ $eq: ["$status", status] }, { $gte: ["$updatedAt", ago(24)] }] }, 1, 0] } }],
        [`${status}7`, { $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] } }],
      ])),
    } },
  ]).toArray();
  const older = await statsCollection(db).find(
    { companyId, kind, hour: { $gte: new Date(Math.floor(ago(30 * 24).getTime() / HOUR_MS) * HOUR_MS), $lt: olderUntil } },
    { projection: { delivered: 1, failed: 1 } },
  ).toArray();
  const value = (key: string) => recent?.[key] ?? 0;
  const sumOlder = (status: "delivered" | "failed") => older.reduce((sum, bucket) => sum + (bucket[status] ?? 0), 0);
  return {
    last24Hours: { delivered: value("delivered24"), failed: value("failed24") },
    last7Days: { delivered: value("delivered7"), failed: value("failed7") },
    last30Days: { delivered: value("delivered7") + sumOlder("delivered"), failed: value("failed7") + sumOlder("failed") },
  };
}

export async function finishDelivery(db: Db, delivery: Delivery, result: ForwardingResult | null) {
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
    $unset: {
      leaseUntil: "", leaseToken: "",
      ...(terminal ? { body: "", signature: "", ...(deliveryKind(delivery) === "calendar" ? { calendarEvent: "" } : {}) } : {}),
    },
  });
  if (terminal) await recordForwardingOutcome(db, delivery, status, now);
}

export function adminCompanyId(principal: Principal) {
  if (!principal.isAdmin || !/^[a-f0-9]{24}$/i.test(principal.companyId)) {
    throw new ManagementError("Somente o administrador da empresa pode gerenciar os encaminhamentos.", 403);
  }
  return new ObjectId(principal.companyId);
}

/** The principal's company, after rechecking that it is still the company's active admin. */
export async function requireAdminCompany(db: Db, principal: Principal) {
  const scope = adminCompanyId(principal);
  const company = await db.collection<{ _id: ObjectId; name?: string }>("companies").findOne({
    _id: scope, adminUserId: new ObjectId(principal.id), status: "active", accessControlVersion: 1,
  });
  if (!company) throw new ManagementError("Administração da empresa não autorizada.", 403);
  return { scope, company };
}

/** Tests are synthetic and immediate; at most one every 5 seconds per company, across both kinds. */
export async function assertTestAllowed(db: Db, scope: ObjectId, session: ClientSession) {
  const recent = await deliveryCollection(db).findOne({
    companyId: scope, isTest: true, createdAt: { $gt: new Date(Date.now() - 5_000) },
  }, { session });
  if (recent) throw new ManagementError("Aguarde 5 segundos entre os testes da empresa.", 429);
}

/**
 * Validates the destination list shared by every kind of forwarding: up to 5 HTTPS endpoints with unique IDs and
 * URLs. `extraKeys` are the kind's own fields, validated and returned by `extend`.
 */
export function validateEndpointList<T extends ForwardingEndpoint>(
  value: unknown,
  extraKeys: readonly string[],
  extend: (endpoint: Record<string, unknown>, base: ForwardingEndpoint) => T,
): T[] {
  if (!Array.isArray(value) || value.length > FORWARDING_ENDPOINT_LIMIT) {
    throw new ManagementError(`Configure no máximo ${FORWARDING_ENDPOINT_LIMIT} destinos.`);
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  const allowed = new Set(["id", "name", "url", "enabled", "maxRetries", ...extraKeys]);
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ManagementError("Destino inválido.");
    const endpoint = item as Record<string, unknown>;
    if (Object.keys(endpoint).some(key => !allowed.has(key)) ||
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
    return extend(endpoint, { id: endpoint.id, name: endpoint.name.trim(), url, enabled: endpoint.enabled, maxRetries: endpoint.maxRetries });
  });
}
