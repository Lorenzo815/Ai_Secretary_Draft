import "server-only";

import { ObjectId, type AnyBulkWriteOperation, type Collection, type Db, type Document } from "mongodb";
import clientPromise from "../mongodb";
import { currentCompanyId, TenantResolutionError } from "./context";
import { COMPANY_OWNED_COLLECTIONS, withCompany } from "./ownership";

const DB_NAME = "ai_secretary";

/**
 * Company-owned collections that every tenant query must be confined to. Excluded on purpose:
 * `users` (authentication looks users up before a company is known; access/ filters explicitly),
 * and Oria's platform-level singletons (`ai_provider_credentials`, `whatsapp_embedded_signup_config`).
 */
export const TENANT_SCOPED_COLLECTIONS: ReadonlySet<string> = new Set([
  ...COMPANY_OWNED_COLLECTIONS.filter((name) => ![
    "users",
    "ai_provider_credentials",
    "whatsapp_embedded_signup_config",
  ].includes(name)),
  "assistant_config_snapshots",
]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/** The application database, with company-owned collections confined to the company in scope. */
export async function tenantDb(companyId?: ObjectId): Promise<Db> {
  const db = (await clientPromise).db(DB_NAME);
  if (companyId) return scopeDb(db, companyId);
  try {
    return scopeDb(db, await currentCompanyId());
  } catch (error) {
    // Index maintenance runs before a company is known (e.g. at the top of a webhook); data access must not.
    if (error instanceof TenantResolutionError) return scopeDb(db, null);
    throw error;
  }
}

const INDEX_MAINTENANCE = new Set(["createIndex", "createIndexes", "indexes", "listIndexes", "indexExists", "indexInformation", "dropIndex", "collectionName", "dbName", "namespace"]);

export function scopeDb(db: Db, companyId: ObjectId | null): Db {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "collection") {
        return (name: string, options?: Parameters<Db["collection"]>[1]) => {
          const collection = target.collection(name, options);
          if (!TENANT_SCOPED_COLLECTIONS.has(name)) return collection;
          return companyId ? scopeCollection(collection, companyId) : indexOnlyCollection(collection);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const FILTER_FIRST = new Set([
  "find", "findOne", "countDocuments", "updateOne", "updateMany", "deleteOne", "deleteMany",
  "findOneAndUpdate", "findOneAndDelete",
]);
const REPLACE = new Set(["replaceOne", "findOneAndReplace"]);
const UNSUPPORTED = new Set(["watch", "initializeOrderedBulkOp", "initializeUnorderedBulkOp", "drop", "rename"]);

export function scopeCollection<T extends Document>(collection: Collection<T>, companyId: ObjectId): Collection<T> {
  const scopeFilter = (filter: Document | undefined) => scopedFilter(filter, companyId);
  const stamp = <D extends object>(document: D) => {
    try {
      return withCompany(document, companyId);
    } catch {
      throw new TenantScopeError("O documento pertence a outra empresa.");
    }
  };
  const checkUpdate = (update: unknown) => {
    if (!update || Array.isArray(update)) return update;
    for (const operator of ["$set", "$setOnInsert"] as const) {
      const value = (update as Record<string, Record<string, unknown> | undefined>)[operator]?.companyId;
      if (value !== undefined && !(value instanceof ObjectId && value.equals(companyId))) {
        throw new TenantScopeError("Não é permitido transferir dados para outra empresa.");
      }
    }
    return update;
  };

  return new Proxy(collection, {
    get(target, property, receiver) {
      if (typeof property === "string" && UNSUPPORTED.has(property)) {
        return () => { throw new TenantScopeError(`Operação ${property} não é permitida em dados de empresa.`); };
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") return value;
      const method = value.bind(target) as (...args: unknown[]) => unknown;
      if (FILTER_FIRST.has(property)) {
        return (filter?: Document, update?: unknown, ...rest: unknown[]) => {
          const scoped = scopeFilter(filter);
          if (property.startsWith("update") || property === "findOneAndUpdate") {
            return method(scoped, checkUpdate(update), ...rest);
          }
          return update === undefined && rest.length === 0 ? method(scoped) : method(scoped, update, ...rest);
        };
      }
      if (REPLACE.has(property)) {
        return (filter: Document, replacement: object, ...rest: unknown[]) =>
          method(scopeFilter(filter), stamp(replacement), ...rest);
      }
      if (property === "insertOne") return (document: object, ...rest: unknown[]) => method(stamp(document), ...rest);
      if (property === "insertMany") {
        return (documents: object[], ...rest: unknown[]) => method(documents.map(stamp), ...rest);
      }
      if (property === "distinct") {
        return (key: string, filter?: Document, ...rest: unknown[]) => method(key, scopeFilter(filter), ...rest);
      }
      if (property === "aggregate") {
        return (pipeline: Document[] = [], ...rest: unknown[]) => {
          const [first, ...others] = pipeline;
          const scoped = first && "$match" in first
            ? [{ ...first, $match: scopeFilter(first.$match) }, ...others]
            : [{ $match: { companyId } }, ...pipeline];
          return method(scoped, ...rest);
        };
      }
      if (property === "estimatedDocumentCount") {
        return (options?: Document) => target.countDocuments({ companyId } as never, options);
      }
      if (property === "bulkWrite") {
        return (operations: AnyBulkWriteOperation<T>[], ...rest: unknown[]) =>
          method(operations.map((operation) => scopeBulkOperation(operation, scopeFilter, stamp, checkUpdate)), ...rest);
      }
      return method;
    },
  });
}

function indexOnlyCollection<T extends Document>(collection: Collection<T>): Collection<T> {
  return new Proxy(collection, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") return value;
      if (INDEX_MAINTENANCE.has(property)) return value.bind(target);
      return () => { throw new TenantResolutionError(); };
    },
  });
}

function scopedFilter(filter: Document | undefined, companyId: ObjectId): Document {
  const current = filter ?? {};
  if (!("companyId" in current)) return { ...current, companyId };
  if (current.companyId instanceof ObjectId && current.companyId.equals(companyId)) return current;
  throw new TenantScopeError("A consulta tentou acessar dados de outra empresa.");
}

function scopeBulkOperation<T extends Document>(
  operation: AnyBulkWriteOperation<T>,
  scopeFilter: (filter: Document | undefined) => Document,
  stamp: <D extends object>(document: D) => D & { companyId: ObjectId },
  checkUpdate: (update: unknown) => unknown,
): AnyBulkWriteOperation<T> {
  const raw = operation as unknown as Record<string, Record<string, unknown>>;
  const [kind] = Object.keys(raw);
  const body = raw[kind];
  if (kind === "insertOne") return { insertOne: { ...body, document: stamp(body.document as object) } } as never;
  const scoped: Record<string, unknown> = { ...body, filter: scopeFilter(body.filter as Document) };
  if (kind === "replaceOne") scoped.replacement = stamp(body.replacement as object);
  if (kind === "updateOne" || kind === "updateMany") scoped.update = checkUpdate(body.update);
  return { [kind]: scoped } as never;
}
