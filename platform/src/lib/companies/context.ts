import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { ObjectId } from "mongodb";
import { companyScopedId, legacyCompanyId, withCompany } from "./ownership";
import { COMPANY_HEADER } from "./tenant-header";

export { COMPANY_HEADER };

const storage = new AsyncLocalStorage<{ companyId: ObjectId }>();
const reportedFallbackSites = new Set<string>();

export class TenantResolutionError extends Error {
  constructor() {
    super("Não foi possível identificar a empresa desta operação.");
    this.name = "TenantResolutionError";
  }
}

/** Runs `operation` with `companyId` as the tenant for every scoped database access inside it. */
export function runWithCompany<T>(companyId: ObjectId, operation: () => T): T {
  return storage.run({ companyId }, operation);
}

/**
 * Resolves the tenant in this order: explicit `runWithCompany` scope, then the trusted proxy header.
 * While multi-tenancy is being rolled out, an unresolved tenant falls back to the original clinic
 * (current behavior). Set TENANT_STRICT=true to fail instead.
 */
export async function currentCompanyId(): Promise<ObjectId> {
  const scoped = storage.getStore()?.companyId;
  if (scoped) return scoped;
  const fromRequest = await companyFromRequestHeader();
  if (fromRequest) return fromRequest;
  if (process.env.TENANT_STRICT === "true") throw new TenantResolutionError();
  reportFallback();
  return legacyCompanyId();
}

/** Logs each distinct code path that relies on the fallback, so it can be scoped before enabling TENANT_STRICT. */
function reportFallback() {
  const site = new Error().stack?.split("\n").slice(3, 7).map((line) => line.trim()).join(" < ") ?? "unknown";
  if (reportedFallbackSites.has(site) || reportedFallbackSites.size >= 200) return;
  reportedFallbackSites.add(site);
  console.warn("[tenant] No company in scope; falling back to the original clinic.", { site });
}

/** Stamps the current company on a new document; refuses to overwrite a different owner. */
export async function withCurrentCompany<T extends object>(document: T): Promise<T & { companyId: ObjectId }> {
  return withCompany(document, await currentCompanyId());
}

/** Adds the current company to a query filter. */
export async function companyFilter<T extends object>(filter: T): Promise<T & { companyId: ObjectId }> {
  return { ...filter, companyId: await currentCompanyId() };
}

/** `_id` of the current company's copy of a per-company settings document. */
export async function scopedSettingsId(key: string): Promise<string> {
  return companyScopedId(await currentCompanyId(), key);
}

export function parseCompanyId(value: unknown): ObjectId | null {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) ? new ObjectId(value) : null;
}

async function companyFromRequestHeader() {
  try {
    const { headers } = await import("next/headers");
    return parseCompanyId((await headers()).get(COMPANY_HEADER));
  } catch {
    // Outside a request (worker, scripts, tests).
    return null;
  }
}
