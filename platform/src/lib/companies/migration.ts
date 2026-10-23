import { createHash, randomBytes } from "node:crypto";
import {
  BSON, type ClientSession, type Db, type Document, type IndexDescription, type MongoClient,
} from "mongodb";
import {
  LEGACY_COMPANY_KEY, legacyCompanyId, type CompanyDocument,
} from "./ownership";
import {
  BATCH_SIZE, BSON_OPTIONS, RESTORE_GUARD_COLLECTION, RESTORE_DATABASE_PREFIX,
  assertCompany, assertDefinitions, assertFieldOnlyChange, assertOwnership,
  assertRestoreDatabase, asRaw, collectionName, decode, digest, requireSafe,
  type CollectionDefinition,
} from "./migration-safety";
import {
  makeHeader, readArchive, writeArchive, type ArchiveSummary, type CollectionManifest,
} from "./migration-backup";
import {
  atStage, attachPriorFailure, attachRestoreDiagnostic, diagnosticError,
  type MigrationDiagnosticError, type RestoreDiagnostic,
} from "./migration-diagnostics";

export interface CollectionReport {
  name: string;
  total: number;
  missing: number;
  owned: number;
}

export interface Inventory {
  collections: CollectionReport[];
  companyPresent: boolean;
}

interface Context {
  // Only restore-test can supply a guard, and its randomly generated DB is checked on every use.
  restoreGuard?: { source: string; nonce: string };
}

const RAW_OPTIONS = { raw: true, ...BSON_OPTIONS };
const TRANSACTION_OPTIONS = {
  readConcern: { level: "snapshot" as const },
  writeConcern: { w: "majority" as const },
  readPreference: "primary" as const,
};

function sortedDefinitions(definitions: CollectionDefinition[]): CollectionDefinition[] {
  return definitions.sort((a, b) => collectionName(a) < collectionName(b) ? -1 : 1);
}

export async function definitions(db: Db, context: Context = {}): Promise<CollectionDefinition[]> {
  if (context.restoreGuard) assertRestoreDatabase(db.databaseName, context.restoreGuard.source);
  const list = await db.listCollections({}, { nameOnly: false, ...BSON_OPTIONS }).toArray();
  // Validate names/options before asking individual collections for indexes.
  const entries = list.map((definition) => ({
    definition, indexes: [{ name: "_id_", key: { _id: 1 } }],
  }));
  assertDefinitions(entries, Boolean(context.restoreGuard));
  const result: CollectionDefinition[] = [];
  for (const definition of list) {
    const indexes = await db.collection(definition.name).listIndexes(BSON_OPTIONS).toArray();
    result.push({ definition, indexes });
  }
  assertDefinitions(result, Boolean(context.restoreGuard));
  return sortedDefinitions(result);
}

function catalogHash(entries: CollectionDefinition[]): string {
  return digest(BSON.serialize({ entries }));
}

async function assertGuard(db: Db, context: Context): Promise<void> {
  if (!context.restoreGuard) return;
  assertRestoreDatabase(db.databaseName, context.restoreGuard.source);
  const documents = await db.collection<Document>(RESTORE_GUARD_COLLECTION).find({}).limit(2).toArray();
  requireSafe(documents.length === 1 &&
    (documents[0]._id as unknown) === context.restoreGuard.nonce &&
    documents[0].purpose === "company-ownership-restore-test",
  "Isolated restore ownership marker is missing; refusing access/cleanup.");
}

export async function assertSnapshotSupport(client: MongoClient): Promise<void> {
  const hello = await client.db("admin").command({ hello: 1 });
  requireSafe((hello.setName || hello.msg === "isdbgrid") &&
    hello.logicalSessionTimeoutMinutes && hello.maxWireVersion >= 13,
  "MongoDB 5+ replica set/mongos with snapshot sessions and transactions is required.");
}

export async function inventory(
  client: MongoClient,
  db: Db,
  context: Context = {},
): Promise<Inventory> {
  await assertGuard(db, context);
  const before = await definitions(db, context);
  const session = client.startSession({ snapshot: true });
  const report: Inventory = { collections: [], companyPresent: false };
  try {
    for (const entry of before) {
      const name = collectionName(entry);
      if (name === RESTORE_GUARD_COLLECTION && context.restoreGuard) continue;
      const counts: CollectionReport = { name, total: 0, missing: 0, owned: 0 };
      const cursor = db.collection(name).find({}, { session, ...RAW_OPTIONS }).sort({ _id: 1 });
      try {
        for await (const value of cursor) {
          const document = decode(asRaw(value));
          counts.total++;
          if (name === "companies") {
            assertCompany(document);
            requireSafe(counts.total === 1, "A second company is not supported.");
            report.companyPresent = true;
          } else {
            assertOwnership(document);
            if (Object.hasOwn(document, "companyId")) counts.owned++;
            else counts.missing++;
          }
        }
      } finally {
        await cursor.close();
      }
      report.collections.push(counts);
    }
    requireSafe(catalogHash(before) === catalogHash(await definitions(db, context)),
      "Collection/index metadata changed during preflight.");
    return report;
  } finally {
    await session.endSession();
  }
}

export async function backupDatabase(
  client: MongoClient,
  db: Db,
  filename: string,
  key: Buffer,
  fingerprint: string,
): Promise<ArchiveSummary> {
  await assertSnapshotSupport(client);
  const catalog = await definitions(db);
  const session = client.startSession({ snapshot: true });
  try {
    return await writeArchive(filename, key, makeHeader(db.databaseName, fingerprint, catalog),
      async function* (name) {
        const cursor = db.collection(name).find({}, { session, ...RAW_OPTIONS }).sort({ _id: 1 });
        try {
          for await (const value of cursor) yield asRaw(value);
        } finally {
          await cursor.close();
        }
      },
      async () => {
        requireSafe("snapshotTime" in session && session.snapshotTime,
          "Server did not establish a consistent snapshot.");
        requireSafe(catalogHash(catalog) === catalogHash(await definitions(db)),
          "Collection/index metadata changed during backup; archive rejected.");
      });
  } finally {
    await session.endSession();
  }
}

export async function bootstrapCompany(
  client: MongoClient,
  db: Db,
  name = "Empresa atual",
  context: Context = {},
): Promise<boolean> {
  requireSafe(typeof name === "string" && name.trim().length > 0 && name.length <= 200,
    "Company name must contain 1–200 characters.");
  const initial = await inventory(client, db, context);
  if (initial.companyPresent) return false;
  const session = client.startSession();
  try {
    const inserted = await session.withTransaction(async () => {
      const existing = await db.collection("companies").find({}, { session, ...RAW_OPTIONS }).limit(2).toArray();
      requireSafe(existing.length <= 1, "A second company is not supported.");
      if (existing.length) {
        assertCompany(decode(asRaw(existing[0])));
        return false;
      }
      const company: CompanyDocument = {
        _id: legacyCompanyId(), key: LEGACY_COMPANY_KEY, name: name.trim(),
        status: "active", isolationReady: false, createdAt: new Date(),
      };
      await db.collection<CompanyDocument>("companies").insertOne(company, { session });
      return true;
    }, TRANSACTION_OPTIONS);
    requireSafe((await inventory(client, db, context)).companyPresent, "Company bootstrap verification failed.");
    return inserted;
  } finally {
    await session.endSession();
  }
}

function idKey(document: Document): string {
  return digest(BSON.serialize({ _id: document._id }));
}

async function backfillBatch(db: Db, name: string, session: ClientSession): Promise<number> {
  const cursor = db.collection(name).find(
    { companyId: { $exists: false } }, { session, ...RAW_OPTIONS },
  ).sort({ _id: 1 }).limit(BATCH_SIZE);
  const originals: { raw: Buffer; document: Document }[] = [];
  let bytes = 0;
  try {
    for await (const value of cursor) {
      const raw = asRaw(value);
      const document = decode(raw);
      requireSafe(!Object.hasOwn(document, "companyId"), "Backfill query returned an owned document.");
      originals.push({ raw, document });
      bytes += raw.length;
      if (bytes >= 8 * 1024 * 1024) break;
    }
  } finally {
    await cursor.close();
  }
  if (!originals.length) return 0;
  const result = await db.collection(name).bulkWrite(originals.map(({ document }) => ({
    updateOne: {
      filter: { _id: document._id, companyId: { $exists: false } },
      update: { $set: { companyId: legacyCompanyId() } },
      upsert: false,
    },
  })), { session, ordered: true });
  requireSafe(result.matchedCount === originals.length && result.modifiedCount === originals.length &&
    result.upsertedCount === 0, "Guarded update count mismatch; aborting transaction.");
  const expected = new Map(originals.map(({ document, raw }) => [idKey(document), raw]));
  requireSafe(expected.size === originals.length, "Duplicate document identities.");
  const after = db.collection(name).find({
    _id: { $in: originals.map(({ document }) => document._id) },
  }, { session, ...RAW_OPTIONS });
  try {
    for await (const value of after) {
      const raw = asRaw(value);
      const key = idKey(decode(raw));
      const before = expected.get(key);
      requireSafe(before, "Unexpected document after guarded backfill.");
      assertFieldOnlyChange(before, raw);
      expected.delete(key);
    }
  } finally {
    await after.close();
  }
  requireSafe(expected.size === 0, "Documents disappeared during backfill; aborting transaction.");
  return originals.length;
}

export async function backfillOwnership(
  client: MongoClient,
  db: Db,
  context: Context = {},
): Promise<{ changed: Record<string, number>; inventory: Inventory }> {
  const initial = await inventory(client, db, context);
  requireSafe(initial.companyPresent, "Run verified bootstrap before backfill.");
  const originalDefinitions = await definitions(db, context);
  const changed: Record<string, number> = {};
  const session = client.startSession();
  try {
    for (const counts of initial.collections) {
      if (counts.name === "companies") continue;
      changed[counts.name] = 0;
      while (true) {
        await assertGuard(db, context);
        requireSafe(catalogHash(originalDefinitions) === catalogHash(await definitions(db, context)),
          "Collection/index metadata changed; stopping backfill.");
        // withTransaction retries write conflicts/transient failures and ambiguous commits.
        // Counters are updated only from the successfully committed callback result.
        const count = await session.withTransaction(
          () => backfillBatch(db, counts.name, session), TRANSACTION_OPTIONS,
        );
        changed[counts.name] += count;
        if (count === 0) break;
      }
    }
  } finally {
    await session.endSession();
  }
  const final = await inventory(client, db, context);
  requireSafe(catalogHash(originalDefinitions) === catalogHash(await definitions(db, context)),
    "Collection/index metadata changed during backfill.");
  requireSafe(final.companyPresent && final.collections.every((entry) => entry.missing === 0),
    "Ownership coverage is incomplete; no isolation may be enabled.");
  return { changed, inventory: final };
}

function normalizedIndex(index: Document): Document {
  const result = { ...index };
  delete result.ns;
  return result;
}

function restorableIndex(index: Document): IndexDescription {
  const restored = normalizedIndex(index);
  // The driver accepts `version`, not the server's `v` metadata field.
  if (Object.hasOwn(restored, "v")) {
    restored.version = restored.v;
    delete restored.v;
  }
  if (restored.key._fts === "text") {
    requireSafe(restored.weights && Object.keys(restored.weights).length > 0,
      "Text index is missing its original field weights.");
    const key: Document = {};
    for (const [field, direction] of Object.entries(restored.key)) {
      if (field === "_fts") {
        for (const textField of Object.keys(restored.weights)) key[textField] = "text";
      } else if (field !== "_ftsx") key[field] = direction;
    }
    restored.key = key;
  }
  return restored as IndexDescription;
}

function isTtl(index: Document): boolean {
  return Object.hasOwn(index, "expireAfterSeconds");
}

async function verifyRestoredCollection(
  db: Db, name: string, manifest: CollectionManifest,
): Promise<void> {
  const hash = createHash("sha256");
  let count = 0;
  const cursor = db.collection(name).find({}, RAW_OPTIONS).sort({ _id: 1 });
  try {
    for await (const value of cursor) {
      const raw = asRaw(value);
      decode(raw);
      hash.update(raw);
      count++;
    }
  } finally {
    await cursor.close();
  }
  requireSafe(count === manifest.count && hash.digest("hex") === manifest.sha256,
    "Restored BSON hashes/counts do not match the encrypted backup.");
}

async function verifyRestoredIndexes(db: Db, definition: CollectionDefinition): Promise<void> {
  const actual = await db.collection(collectionName(definition)).listIndexes(BSON_OPTIONS).toArray();
  const expected = definition.indexes.filter((index) => !isTtl(index));
  const canonical = (indexes: Document[]) => indexes.map((index) => {
    const normalized = normalizedIndex(index);
    // The server may reorder index-spec fields, not index key fields.
    return {
      name: index.name,
      fields: Object.fromEntries(Object.keys(normalized).sort().map((key) => [key, normalized[key]])),
    };
  }).sort((a, b) => a.name < b.name ? -1 : 1);
  requireSafe(Buffer.from(BSON.serialize({ indexes: canonical(actual) })).equals(
    Buffer.from(BSON.serialize({ indexes: canonical(expected) }))),
  "Restored non-TTL index metadata differs from the backup.");
}

async function assertMigratedBusinessData(
  db: Db, backup: string, key: Buffer, original: ArchiveSummary,
): Promise<void> {
  let pending: { raw: Buffer; before: Document }[] = [];
  let pendingBytes = 0;
  const flush = async (name: string) => {
    if (!pending.length) return;
    const expected = new Map(pending.map((item) => [idKey(item.before), item]));
    requireSafe(expected.size === pending.length, "Duplicate restored document identities.");
    const cursor = db.collection(name).find({
      _id: { $in: pending.map((item) => item.before._id) },
    }, RAW_OPTIONS);
    try {
      for await (const value of cursor) {
        const after = asRaw(value);
        const identity = idKey(decode(after));
        const item = expected.get(identity);
        requireSafe(item, "Unexpected restored document identity.");
        if (name === "companies" || Object.hasOwn(item.before, "companyId")) {
          requireSafe(after.equals(item.raw), "A pre-owned document changed during migration rehearsal.");
        } else assertFieldOnlyChange(item.raw, after);
        expected.delete(identity);
      }
    } finally {
      await cursor.close();
    }
    requireSafe(expected.size === 0, "A restored document disappeared during migration rehearsal.");
    pending = [];
    pendingBytes = 0;
  };
  const checked = await readArchive(backup, key, {
    document: async (name, raw) => {
      pending.push({ raw, before: decode(raw) });
      pendingBytes += raw.length;
      if (pending.length >= BATCH_SIZE || pendingBytes >= 8 * 1024 * 1024) await flush(name);
    },
    endCollection: async (manifest) => flush(manifest.name),
  });
  requireSafe(checked.backupSha256 === original.backupSha256, "Backup changed during restore rehearsal.");
}

export interface RestoreResult {
  summary: ArchiveSummary;
  isolatedDatabase: string;
  ttlIndexesSkipped: number;
}

export async function restoreAndRehearse(
  client: MongoClient,
  backup: string,
  key: Buffer,
  sourceDatabase: string,
  fingerprint: string,
): Promise<RestoreResult> {
  const diagnostic: RestoreDiagnostic = { scratchDatabasePrefix: RESTORE_DATABASE_PREFIX, cleanup: "not-created" };
  try {
  // Authenticate every byte before connecting an archive to any database writes.
  const summary = await atStage("restore.archive-validation", () => readArchive(backup, key));
  await atStage("restore.source-binding", async () => {
    requireSafe(summary.header.database === sourceDatabase &&
      summary.header.sourceFingerprint === fingerprint, "Backup source binding differs.");
  });
  await atStage("restore.snapshot-support", () => assertSnapshotSupport(client));
  const target = `${RESTORE_DATABASE_PREFIX}${randomBytes(16).toString("hex")}`;
  diagnostic.scratchDatabase = target;
  assertRestoreDatabase(target, sourceDatabase);
  await atStage("restore.database-availability", async () => {
    const existing = await client.db("admin").admin().listDatabases({
      nameOnly: true, filter: { name: target },
    });
    requireSafe(existing.databases.length === 0, "Isolated restore database already exists.");
  });
  const db = client.db(target);
  const context = { restoreGuard: { source: sourceDatabase, nonce: randomBytes(32).toString("hex") } };
  let owned = false;
  let ttlIndexesSkipped = 0;
  let failure: MigrationDiagnosticError | undefined;
  try {
    // No drop is attempted until the tool's own marker has been created successfully.
    diagnostic.cleanup = "not-confirmed";
    await atStage("restore.marker-create", () =>
      db.createCollection(RESTORE_GUARD_COLLECTION, { writeConcern: { w: "majority" } }));
    await atStage("restore.marker-insert", () => db.collection(RESTORE_GUARD_COLLECTION).insertOne({
      _id: context.restoreGuard.nonce, purpose: "company-ownership-restore-test",
    } as Document, { writeConcern: { w: "majority" } }));
    owned = true;
    let pending: Document[] = [];
    let pendingBytes = 0;
    const flush = async (name: string) => {
      if (!pending.length) return;
      await atStage("restore.document-insert", () =>
        db.collection(name).insertMany(pending, { ordered: true, writeConcern: { w: "majority" } }));
      pending = [];
      pendingBytes = 0;
    };
    const restored = await atStage("restore.archive-replay", () => readArchive(backup, key, {
      collection: async (entry) => {
        assertRestoreDatabase(db.databaseName, sourceDatabase);
        await atStage("restore.collection-create", () =>
          db.createCollection(collectionName(entry), { writeConcern: { w: "majority" } }));
      },
      document: async (name, raw) => {
        pending.push(decode(raw));
        pendingBytes += raw.length;
        if (pending.length >= BATCH_SIZE || pendingBytes >= 8 * 1024 * 1024) await flush(name);
      },
      endCollection: async (manifest) => {
        await flush(manifest.name);
        await atStage("restore.bson-verify", () => verifyRestoredCollection(db, manifest.name, manifest));
      },
    }));
    await atStage("restore.archive-binding", async () => {
      requireSafe(restored.backupSha256 === summary.backupSha256, "Backup changed during restore.");
    });
    for (const entry of summary.header.definitions) {
      const secondary = entry.indexes.filter((index) => index.name !== "_id_" && !isTtl(index));
      ttlIndexesSkipped += entry.indexes.filter(isTtl).length;
      if (secondary.length) {
        await atStage("restore.index-create", () => db.collection(collectionName(entry)).createIndexes(
          secondary.map(restorableIndex),
        ));
      }
      await atStage("restore.index-verify", () => verifyRestoredIndexes(db, entry));
    }
    await atStage("restore.migration-dry-run", () => inventory(client, db, context));
    await atStage("restore.bootstrap-rehearsal", () => bootstrapCompany(client, db, "Empresa atual", context));
    await atStage("restore.backfill-rehearsal", () => backfillOwnership(client, db, context));
    await atStage("restore.business-bson-verify", () => assertMigratedBusinessData(db, backup, key, summary));
    await atStage("restore.idempotence-rehearsal", async () => {
      const second = await backfillOwnership(client, db, context);
      requireSafe(Object.values(second.changed).every((count) => count === 0),
        "Migration rehearsal was not idempotent.");
    });
    await atStage("restore.business-bson-verify", () => assertMigratedBusinessData(db, backup, key, summary));
    // Rehearsal must never alter even non-TTL index metadata.
    for (const entry of summary.header.definitions) {
      await atStage("restore.index-verify", () => verifyRestoredIndexes(db, entry));
    }
    await atStage("restore.final-count-verify", async () => {
    for (const entry of summary.collections) {
      const count = await db.collection(entry.name).countDocuments();
      const expected = entry.name === "companies" && entry.count === 0 ? 1 : entry.count;
      requireSafe(count === expected, "Migration rehearsal changed document counts.");
    }
    });
    return { summary, isolatedDatabase: target, ttlIndexesSkipped };
  } catch (error) {
    failure = diagnosticError(error, "cli.restore-test");
    throw failure;
  } finally {
    if (owned) {
      try {
        await atStage("restore.cleanup-guard", async () => {
          await assertGuard(db, context);
          assertRestoreDatabase(target, sourceDatabase);
        });
        await atStage("restore.cleanup-drop", () => db.dropDatabase({ writeConcern: { w: "majority" } }));
        await atStage("restore.cleanup-confirm", async () => {
          const remaining = await client.db("admin").admin().listDatabases({
            nameOnly: true, filter: { name: target },
          });
          requireSafe(remaining.databases.length === 0, "Isolated restore cleanup could not be verified.");
        });
        diagnostic.cleanup = "confirmed";
      } catch (error) {
        const cleanupFailure = diagnosticError(error, "restore.cleanup-confirm");
        if (failure) attachPriorFailure(cleanupFailure, failure);
        throw cleanupFailure;
      }
    }
  }
  } catch (error) {
    const failure = diagnosticError(error, "cli.restore-test");
    attachRestoreDiagnostic(failure, diagnostic);
    throw failure;
  }
}
