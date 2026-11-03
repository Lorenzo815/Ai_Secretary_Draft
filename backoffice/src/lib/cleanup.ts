import "server-only";

import { ObjectId, type Document } from "mongodb";
import { audit } from "./audit";
import { liveCompanyIds } from "./explorer";
import { getDb } from "./mongodb";
import { assertConfirmed, requiredConfirmation } from "./risk";
import { CLEANUP_TARGETS, cleanupFilter, type CleanupTarget } from "./cleanup-rules";

export { CLEANUP_TARGETS, type CleanupTarget } from "./cleanup-rules";

export interface CleanupScope {
  /** Selected clinic ids; empty = every clinic. */
  companyIds: string[];
  olderThanDays: number;
}

export interface CleanupPreview {
  target: CleanupTarget;
  count: number;
  /** Rough data size freed: documents × average document size of the collection. */
  estimatedBytes: number;
  /** Delete runs: run steps removed with them. */
  relatedCount?: number;
}

function parseScope(scope: CleanupScope) {
  if (!Number.isInteger(scope.olderThanDays) || scope.olderThanDays < 7 || scope.olderThanDays > 3650) {
    throw new Error("Escolha uma idade mínima de 7 a 3650 dias.");
  }
  if (!Array.isArray(scope.companyIds) || scope.companyIds.some((id) => !ObjectId.isValid(id))) throw new Error("Clínica inválida.");
  const unique = [...new Set(scope.companyIds)];
  return {
    companyIds: unique.length > 0 ? unique.map((id) => new ObjectId(id)) : null,
    cutoff: new Date(Date.now() - scope.olderThanDays * 86_400_000),
  };
}

/** What each target would remove now. Read-only. */
export async function previewCleanup(scope: CleanupScope): Promise<CleanupPreview[]> {
  const { companyIds, cutoff } = parseScope(scope);
  const context = await loadContext(companyIds);
  return Promise.all((Object.keys(CLEANUP_TARGETS) as CleanupTarget[]).map(async (target) => {
    const plan = await planTarget(target, companyIds, cutoff, context);
    return { target, count: plan.count, estimatedBytes: plan.estimatedBytes, ...(plan.related ? { relatedCount: plan.related.count } : {}) };
  }));
}

/** Removes the target's documents. Typed confirmation with the document count (plus PRODUCAO for clinics in production). */
export async function runCleanup(actor: string, target: CleanupTarget, scope: CleanupScope, confirmation?: string) {
  if (!Object.hasOwn(CLEANUP_TARGETS, target)) throw new Error("Tipo de limpeza inválido.");
  const { companyIds, cutoff } = parseScope(scope);
  const context = await loadContext(companyIds);
  const plan = await planTarget(target, companyIds, cutoff, context);
  if (plan.count === 0) return { deleted: 0, related: 0 };
  const definition = CLEANUP_TARGETS[target];
  const live = await liveCompanyIds();
  const touchesProduction = companyIds ? companyIds.some((id) => live.has(id.toHexString())) : live.size > 0;
  const scopeText = companyIds ? `${companyIds.length} clínica(s) selecionada(s)` : "todas as clínicas";
  assertConfirmed(
    requiredConfirmation({ operation: "bulk-delete", collection: definition.collection, touchesProduction, count: plan.count }),
    confirmation,
    `${definition.action === "compact" ? "Compactar" : "Excluir"} ${plan.count} documento(s) de ${definition.collection} com mais de ${scope.olderThanDays} dias (${scopeText}). Esta ação não pode ser desfeita.`,
  );

  const db = await getDb();
  let related = 0;
  if (plan.related) related = (await db.collection(plan.related.collection).deleteMany(plan.related.filter)).deletedCount;
  const deleted = (await db.collection(definition.collection).deleteMany(plan.filter)).deletedCount;
  await audit({
    actor,
    action: `cleanup:${target}`,
    collection: definition.collection,
    companyId: companyIds?.length === 1 ? companyIds[0].toHexString() : null,
    filter: plan.filter,
    count: deleted,
    detail: `Limpeza de histórico (${definition.label}), mais de ${scope.olderThanDays} dias, ${companyIds ? `clínicas ${companyIds.map((id) => id.toHexString()).join(", ")}` : "todas as clínicas"}${plan.related ? `; ${related} documento(s) relacionados em ${plan.related.collection}` : ""}.`,
  });
  return { deleted, related };
}

interface Context {
  /** Jobs still in the queue: their runs may be resumed and must stay intact. */
  queuedJobIds: ObjectId[];
}

async function loadContext(companyIds: ObjectId[] | null): Promise<Context> {
  const jobs = await (await getDb()).collection("automation_jobs")
    .find(companyIds ? { companyId: { $in: companyIds } } : {}, { projection: { _id: 1 } }).toArray();
  return { queuedJobIds: jobs.map((job) => job._id as ObjectId) };
}

async function planTarget(target: CleanupTarget, companyIds: ObjectId[] | null, cutoff: Date, context: Context) {
  const db = await getDb();
  const definition = CLEANUP_TARGETS[target];
  let filter: Document;
  let related: { collection: string; filter: Document } | undefined;

  if (target === "runs_compact" || target === "runs_delete") {
    const runIds = (await db.collection("assistant_runs")
      .find(cleanupFilter("runs_delete", { companyIds, cutoff, queuedJobIds: context.queuedJobIds }), { projection: { _id: 1 } })
      .toArray()).map((run) => run._id as ObjectId);
    const steps = { runId: { $in: runIds } };
    if (target === "runs_compact") filter = steps;
    else {
      filter = { _id: { $in: runIds } };
      related = { collection: "assistant_run_steps", filter: steps };
    }
  } else if (target === "lead_qualification_history") {
    // The most recent qualification of each patient is always kept.
    const latest = await db.collection("lead_qualification_history").aggregate<{ _id: ObjectId; latestId: ObjectId }>([
      ...(companyIds ? [{ $match: { companyId: { $in: companyIds } } }] : []),
      { $sort: { generatedAt: -1 } },
      { $group: { _id: "$customerId", latestId: { $first: "$_id" } } },
    ]).toArray();
    filter = cleanupFilter(target, { companyIds, cutoff, keepIds: latest.map((item) => item.latestId) });
  } else {
    filter = cleanupFilter(target, { companyIds, cutoff });
  }

  const [count, relatedCount, avg, relatedAvg] = await Promise.all([
    db.collection(definition.collection).countDocuments(filter),
    related ? db.collection(related.collection).countDocuments(related.filter) : Promise.resolve(0),
    averageDocumentSize(definition.collection),
    related ? averageDocumentSize(related.collection) : Promise.resolve(0),
  ]);
  return {
    filter,
    count,
    estimatedBytes: Math.round(count * avg + relatedCount * relatedAvg),
    related: related ? { ...related, count: relatedCount } : undefined,
  };
}

async function averageDocumentSize(collection: string) {
  const stats = await (await getDb()).collection(collection)
    .aggregate<{ storageStats?: { avgObjSize?: number } }>([{ $collStats: { storageStats: {} } }])
    .toArray().catch(() => []);
  return stats[0]?.storageStats?.avgObjSize ?? 0;
}
