import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { BSON, ObjectId, type Document } from "mongodb";
import {
  COMPANY_OWNED_COLLECTIONS,
  LEGACY_COMPANY_ID,
  LEGACY_COMPANY_KEY,
} from "./ownership";

export const DEFAULT_DATABASE = "ai_secretary";
export const RESTORE_GUARD_COLLECTION = "_company_ownership_restore_guard";
export const BSON_OPTIONS = {
  promoteValues: false, promoteLongs: false, promoteBuffers: false, bsonRegExp: true,
} as const;
export const BATCH_SIZE = 200;
export const RESTORE_DATABASE_PREFIX = "cmr_" as const;
export const RESTORE_DATABASE_PATTERN = /^cmr_[a-f0-9]{32}$/;
const LEGACY_RESTORE_DATABASE_PATTERN = /^company_restore_[a-f0-9]{32}$/;

export class MigrationSafetyError extends Error {}

export function requireSafe(condition: unknown, message: string): asserts condition {
  if (!condition) throw new MigrationSafetyError(message);
}

export function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sourceFingerprint(uri: string, key: Buffer): string {
  return createHmac("sha256", key).update("company-ownership-source-v1\0").update(uri).digest("hex");
}

export function decode(raw: Buffer): Document {
  const document = BSON.deserialize(raw, BSON_OPTIONS);
  requireSafe(Buffer.from(BSON.serialize(document)).equals(raw), "BSON cannot be round-tripped losslessly.");
  requireSafe(Object.hasOwn(document, "_id"), "Document without an _id is unsupported.");
  return document;
}

export function asRaw(value: unknown): Buffer {
  requireSafe(Buffer.isBuffer(value), "The database did not return raw BSON.");
  return value;
}

export function assertOwnership(document: Document): void {
  if (!Object.hasOwn(document, "companyId")) return;
  requireSafe(
    document.companyId instanceof ObjectId &&
      document.companyId.toHexString() === LEGACY_COMPANY_ID,
    "Conflicting, null, or invalid company ownership; refusing all writes.",
  );
}

export function assertCompany(document: Document): void {
  const fields = ["_id", "key", "name", "status", "isolationReady", "createdAt",
    "adminUserId", "accessControlVersion", "userManagementVersion", "legalName", "cnpj", "contactEmail", "contactPhone"];
  const accessConfigured = Object.hasOwn(document, "accessControlVersion");
  const numeric = (value: unknown) => typeof value === "number" ||
    value instanceof BSON.Int32 || value instanceof BSON.Double || value instanceof BSON.Long;
  requireSafe(
    accessConfigured
      ? numeric(document.accessControlVersion) && Number(document.accessControlVersion) === 1 &&
        document.adminUserId instanceof ObjectId && numeric(document.userManagementVersion) &&
        Number.isSafeInteger(Number(document.userManagementVersion)) && Number(document.userManagementVersion) >= 0
      : !Object.hasOwn(document, "adminUserId") && !Object.hasOwn(document, "userManagementVersion"),
    "Company access-control metadata is invalid.",
  );
  for (const key of ["legalName", "cnpj", "contactEmail", "contactPhone"]) {
    requireSafe(!Object.hasOwn(document, key) || typeof document[key] === "string", "Company profile metadata is invalid.");
  }
  requireSafe(
    document._id instanceof ObjectId &&
      document._id.toHexString() === LEGACY_COMPANY_ID &&
      document.key === LEGACY_COMPANY_KEY &&
      typeof document.name === "string" && document.name.trim().length > 0 &&
      document.status === "active" &&
      document.isolationReady === false &&
      document.createdAt instanceof Date &&
      Number.isFinite(document.createdAt.getTime()) &&
      Object.keys(document).every((key) => fields.includes(key)),
    "Only the initial legacy company with isolationReady:false is supported.",
  );
}

export function assertFieldOnlyChange(before: Buffer, after: Buffer): void {
  const original = decode(before);
  requireSafe(!Object.hasOwn(original, "companyId"), "Backfill must target only missing fields.");
  const updated = decode(after);
  assertOwnership(updated);
  requireSafe(Object.hasOwn(updated, "companyId"), "Backfill did not add companyId.");
  delete updated.companyId;
  requireSafe(
    Buffer.from(BSON.serialize(updated)).equals(before),
    "Business BSON changed; aborting this transaction.",
  );
}

export interface CollectionDefinition {
  definition: Document;
  indexes: Document[];
}

export function collectionName(entry: CollectionDefinition): string {
  return entry.definition.name as string;
}

export function assertDefinitions(
  definitions: CollectionDefinition[],
  allowRestoreGuard = false,
): void {
  const seen = new Set<string>();
  for (const entry of definitions) {
    const name = collectionName(entry);
    requireSafe(
      typeof name === "string" &&
        (COMPANY_OWNED_COLLECTIONS.some((known) => known === name) ||
          name === "companies" || (allowRestoreGuard && name === RESTORE_GUARD_COLLECTION)),
      "Unknown collection; refusing ambiguous ownership.",
    );
    requireSafe(!seen.has(name), "Duplicate collection definition.");
    seen.add(name);
    requireSafe(
      entry.definition.type === "collection" &&
        entry.definition.options && Object.keys(entry.definition.options).length === 0 &&
        entry.definition.info?.readOnly !== true,
      "Only ordinary collections without options are supported.",
    );
    requireSafe(Array.isArray(entry.indexes), "Missing index definitions.");
    const indexNames = new Set<string>();
    for (const index of entry.indexes) {
      requireSafe(
        typeof index.name === "string" && !indexNames.has(index.name) &&
          index.key && typeof index.key === "object" &&
          !Object.hasOwn(index, "buildUUID"),
        "Unsupported or in-progress index definition.",
      );
      indexNames.add(index.name);
    }
    requireSafe(indexNames.has("_id_"), "An ordinary _id index is required.");
  }
}

export function assertDatabaseName(database: string): void {
  requireSafe(
    /^[A-Za-z0-9_-]{1,63}$/.test(database) &&
      !["admin", "config", "local"].includes(database) &&
      !RESTORE_DATABASE_PATTERN.test(database) &&
      !LEGACY_RESTORE_DATABASE_PATTERN.test(database),
    "Invalid or protected source database.",
  );
}

export function assertConfirmation(database: string, confirmation: string | undefined): void {
  assertDatabaseName(database);
  requireSafe(
    confirmation === `${database}:${LEGACY_COMPANY_ID}`,
    "Explicit --confirm-production DATABASE:COMPANY_ID is required for bootstrap/apply.",
  );
}

export function assertRestoreDatabase(target: string, source: string): void {
  requireSafe(
    RESTORE_DATABASE_PATTERN.test(target) && target !== source,
    "Restore/cleanup may only address a newly generated isolated database.",
  );
}

export function parseKey(encoded: string | undefined): Buffer {
  requireSafe(
    encoded && /^[A-Za-z0-9+/]{43}=$/.test(encoded),
    "COMPANY_MIGRATION_BACKUP_KEY must be canonical base64 encoding of 32 bytes.",
  );
  const key = Buffer.from(encoded, "base64");
  requireSafe(key.length === 32 && key.toString("base64") === encoded, "Invalid backup key.");
  return key;
}

export function equalMac(actual: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) &&
    relative !== ".." && !path.isAbsolute(relative));
}

export async function externalPath(
  filename: string,
  repository: string,
  mustExist: boolean,
): Promise<string> {
  requireSafe(
    path.isAbsolute(filename) && !filename.startsWith("\\\\") && !filename.startsWith("//"),
    "Artifact paths must be absolute local paths outside the repository.",
  );
  const parent = await realpath(path.dirname(filename));
  const root = await realpath(repository);
  const canonical = path.join(parent, path.basename(filename));
  requireSafe(!isWithin(root, canonical), "Backups/receipts must not be stored in the repository.");
  if (mustExist) {
    const info = await lstat(canonical);
    requireSafe(info.isFile() && !info.isSymbolicLink(), "Artifact must be a regular, non-symlink file.");
    requireSafe(!isWithin(root, await realpath(canonical)), "Artifact resolves inside the repository.");
  } else {
    let exists = false;
    try {
      await lstat(canonical);
      exists = true;
    } catch (error) {
      requireSafe((error as NodeJS.ErrnoException).code === "ENOENT", "Cannot validate artifact path.");
    }
    requireSafe(!exists, "Refusing to overwrite an existing artifact.");
  }
  return canonical;
}
