import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { ObjectId } from "mongodb";
import { legacyCompanyId } from "./ownership";
import { COMPANY_HEADER } from "./tenant-header";

export { COMPANY_HEADER };

const storage = new AsyncLocalStorage<{ companyId: ObjectId }>();
let fallbackWarned = false;

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
  if (!fallbackWarned) {
    fallbackWarned = true;
    console.warn("[tenant] No company in scope; falling back to the original clinic.");
  }
  return legacyCompanyId();
}

/** Stamps the current company on a new document; refuses to overwrite a different owner. */
export async function withCurrentCompany<T extends object>(document: T): Promise<T & { companyId: ObjectId }> {
  const companyId = await currentCompanyId();
  if ("companyId" in document && (
    !(document.companyId instanceof ObjectId) || !document.companyId.equals(companyId)
  )) {
    throw new Error("A propriedade da empresa já existe e não pode ser substituída.");
  }
  return { ...document, companyId };
}

/** Adds the current company to a query filter. */
export async function companyFilter<T extends object>(filter: T): Promise<T & { companyId: ObjectId }> {
  return { ...filter, companyId: await currentCompanyId() };
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
