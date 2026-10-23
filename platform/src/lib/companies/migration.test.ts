import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BSON, Int32, MongoClient, ObjectId, Timestamp, type Db, type Document,
} from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/company-ownership";
import { legacyCompanyId } from "./ownership";
import { makeReceipt, readArchive } from "./migration-backup";
import {
  assertSnapshotSupport, backupDatabase, backfillOwnership, bootstrapCompany,
  inventory, restoreAndRehearse,
} from "./migration";
import { BSON_OPTIONS, RESTORE_GUARD_COLLECTION, decode, digest, sourceFingerprint } from "./migration-safety";
import * as safety from "./migration-safety";
import { formatDiagnostic } from "./migration-diagnostics";

const raw = (value: Document) => Buffer.from(BSON.serialize(value));
const identity = (value: unknown) => digest(BSON.serialize({ value }));
const key = Buffer.alloc(32, 3);
const fingerprint = sourceFingerprint("mongodb://offline-test.invalid", key);

// A transaction-aware raw-BSON driver double. No MongoClient is ever connected.
class Cursor {
  private maximum = Infinity;
  constructor(private values: Document[]) {}
  sort() {
    this.values.sort((a, b) => identity(decode(a as unknown as Buffer)._id)
      .localeCompare(identity(decode(b as unknown as Buffer)._id)));
    return this;
  }
  limit(maximum: number) { this.maximum = maximum; return this; }
  async toArray() { return this.values.slice(0, this.maximum); }
  async close() {}
  async *[Symbol.asyncIterator]() { yield* await this.toArray(); }
}

interface Store { documents: Buffer[]; indexes: Document[]; options: Document; type: string }

class FakeCollection {
  constructor(private db: FakeDatabase, private name: string) {}
  store() { return this.db.ensure(this.name); }
  find(filter: Document = {}, options: Document = {}) {
    this.db.client.reads.push({ db: this.db.databaseName, name: this.name, options });
    const documents = (this.db.stores.get(this.name)?.documents ?? []).filter((bytes) => {
      const document = decode(bytes);
      if (filter.companyId?.$exists === false && Object.hasOwn(document, "companyId")) return false;
      if (Object.hasOwn(filter, "_id")) {
        const choices = filter._id && Object.hasOwn(filter._id, "$in") ? filter._id.$in : [filter._id];
        if (!choices.some((id: unknown) => identity(id) === identity(document._id))) return false;
      }
      return true;
    });
    return new Cursor(documents.map((bytes) => options.raw ? Buffer.from(bytes) :
      BSON.deserialize(bytes)) as Document[]);
  }
  async findOne(filter: Document, options: Document = {}) {
    return (await this.find(filter, options).limit(1).toArray())[0] ?? null;
  }
  listIndexes() {
    const indexes = this.store().indexes;
    return { toArray: async () => indexes.map((index) => BSON.deserialize(raw(index), BSON_OPTIONS)) };
  }
  async insertOne(document: Document) {
    this.db.client.writes.push({ db: this.db.databaseName, name: this.name, kind: "insert" });
    this.store().documents.push(raw(document));
    return { acknowledged: true, insertedId: document._id };
  }
  async insertMany(documents: Document[]) {
    for (const document of documents) await this.insertOne(document);
  }
  async countDocuments() { return this.store().documents.length; }
  async createIndexes(indexes: Document[]) {
    for (const input of indexes) {
      this.db.client.writes.push({ db: this.db.databaseName, name: this.name, kind: "index", index: input });
      const index: Document = { ...input, v: input.version ?? new Int32(2) };
      delete index.version;
      this.store().indexes.push(index);
    }
  }
  async bulkWrite(operations: Document[]) {
    this.db.client.batchSizes.push(operations.length);
    let matched = 0;
    for (const operation of operations) {
      expect(operation.updateOne.upsert).toBe(false);
      expect(operation.updateOne.filter.companyId).toEqual({ $exists: false });
      expect(Object.keys(operation.updateOne.update)).toEqual(["$set"]);
      expect(Object.keys(operation.updateOne.update.$set)).toEqual(["companyId"]);
      const docs = this.store().documents;
      const index = docs.findIndex((bytes) => {
        const document = decode(bytes);
        return identity(document._id) === identity(operation.updateOne.filter._id) &&
          !Object.hasOwn(document, "companyId");
      });
      if (index < 0) continue;
      const document = decode(docs[index]);
      document.companyId = operation.updateOne.update.$set.companyId;
      if (this.db.client.corruptBusinessField) document.updatedAt = new Date(123);
      docs[index] = raw(document);
      matched++;
    }
    this.db.client.writes.push({ db: this.db.databaseName, name: this.name, kind: "backfill" });
    return { matchedCount: matched, modifiedCount: matched - (this.db.client.countMismatch ? 1 : 0), upsertedCount: 0 };
  }
}

class FakeDatabase {
  stores = new Map<string, Store>();
  constructor(public client: FakeClient, public databaseName: string) {}
  ensure(name: string) {
    if (!this.stores.has(name)) {
      this.stores.set(name, {
        documents: [], type: "collection", options: {},
        indexes: [{ v: new Int32(2), key: { _id: new Int32(1) }, name: "_id_" }],
      });
    }
    return this.stores.get(name)!;
  }
  collection(name: string) { return new FakeCollection(this, name); }
  listCollections() {
    return { toArray: async () => [...this.stores.entries()].map(([name, store]) => ({
      name, type: store.type, options: store.options, info: { readOnly: false },
    })) };
  }
  async createCollection(name: string) {
    if (this.stores.has(name)) throw new Error("already exists");
    this.client.writes.push({ db: this.databaseName, name, kind: "create" });
    this.ensure(name);
  }
  async command() {
    return this.client.standalone ? { maxWireVersion: 25 } :
      { setName: "offline", logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 };
  }
  admin() {
    return {
      listDatabases: async (options: Document) => ({
        databases: this.client.databases.has(options.filter.name) &&
          this.client.databases.get(options.filter.name)!.stores.size ?
          [{ name: options.filter.name }] : [],
      }),
    };
  }
  async dropDatabase() {
    this.client.dropped.push(this.databaseName);
    this.client.databases.delete(this.databaseName);
    return true;
  }
}

class FakeClient {
  databases = new Map<string, FakeDatabase>();
  reads: { db: string; name: string; options: Document }[] = [];
  writes: { db: string; name: string; kind: string; index?: Document }[] = [];
  dropped: string[] = [];
  batchSizes: number[] = [];
  sessionOptions: Document[] = [];
  transactions = 0;
  aborts = 0;
  standalone = false;
  corruptBusinessField = false;
  countMismatch = false;
  retryOnce = false;
  externalChange?: () => void;
  db(name: string) {
    if (!this.databases.has(name)) this.databases.set(name, new FakeDatabase(this, name));
    return this.databases.get(name)!;
  }
  startSession(options: Document = {}) {
    this.sessionOptions.push(options);
    return {
      snapshotTime: new Timestamp({ t: 1, i: 1 }),
      async endSession() {},
      withTransaction: async <T>(callback: () => Promise<T>, settings: Document): Promise<T> => {
        expect(settings.readConcern).toEqual({ level: "snapshot" });
        expect(settings.writeConcern).toEqual({ w: "majority" });
        const snapshot = new Map([...this.databases].map(([name, db]) =>
          [name, new Map([...db.stores].map(([collection, store]) =>
            [collection, { ...store, documents: store.documents.map((bytes) => Buffer.from(bytes)),
              indexes: [...store.indexes] }]))]));
        const rollback = () => {
          for (const [name, stores] of snapshot) this.db(name).stores = stores;
        };
        this.transactions++;
        try {
          const result = await callback();
          if (this.retryOnce) {
            this.retryOnce = false;
            rollback();
            this.externalChange?.();
            return await callback();
          }
          return result;
        } catch (error) {
          this.aborts++;
          rollback();
          throw error;
        }
      },
    };
  }
}

const asClient = (client: FakeClient) => client as unknown as MongoClient;
const asDb = (db: FakeDatabase) => db as unknown as Db;
const seed = (db: FakeDatabase, name: string, documents: Document[]) => {
  db.ensure(name).documents = documents.map(raw);
};
const company = () => ({
  _id: legacyCompanyId(), key: "legacy", name: "Original name", status: "active",
  isolationReady: false, createdAt: new Date(0),
});

describe("guarded additive migration with transactional driver doubles", () => {
  let client: FakeClient;
  let db: FakeDatabase;
  beforeEach(() => {
    client = new FakeClient();
    db = client.db("ai_secretary");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("dry-run does not write, reports counts, and rejects conflicts before any batch", async () => {
    seed(db, "crm_customers", [{ _id: "a" }, { _id: new ObjectId(), companyId: legacyCompanyId() }]);
    const result = await inventory(asClient(client), asDb(db));
    expect(result.collections).toEqual([{ name: "crm_customers", total: 2, missing: 1, owned: 1 }]);
    expect(client.writes).toEqual([]);
    seed(db, "companies", [company()]);
    seed(db, "users", [{ _id: "conflict", companyId: null }]);
    await expect(backfillOwnership(asClient(client), asDb(db))).rejects.toThrow("ownership");
    expect(client.writes).toEqual([]);
  });

  it("fails closed on unknown collections/options/types and multiple companies without writing", async () => {
    seed(db, "unknown", []);
    await expect(inventory(asClient(client), asDb(db))).rejects.toThrow("Unknown");
    db.stores.delete("unknown");
    db.ensure("crm_customers").options = { capped: true };
    await expect(inventory(asClient(client), asDb(db))).rejects.toThrow("ordinary");
    db.stores.delete("crm_customers");
    db.ensure("users").type = "view";
    await expect(inventory(asClient(client), asDb(db))).rejects.toThrow("ordinary");
    db.stores.delete("users");
    seed(db, "companies", [company(), { ...company(), _id: new ObjectId() }]);
    await expect(inventory(asClient(client), asDb(db))).rejects.toThrow();
    expect(client.writes).toEqual([]);
  });

  it("bootstrap inserts once, never replaces a company, and keeps isolation disabled", async () => {
    expect(await bootstrapCompany(asClient(client), asDb(db), "Requested name")).toBe(true);
    const before = db.ensure("companies").documents[0];
    expect(decode(before).name).toBe("Requested name");
    expect(decode(before).isolationReady).toBe(false);
    expect(await bootstrapCompany(asClient(client), asDb(db), "Must not overwrite")).toBe(false);
    expect(db.ensure("companies").documents[0]).toEqual(before);
    expect(client.writes.map((write) => write.kind)).toEqual(["insert"]);
  });

  it("backfills batches of at most 200; preserves string/ObjectId IDs, BSON types, orphans, revisions, hashes and timestamps", async () => {
    seed(db, "companies", [company()]);
    const documents = Array.from({ length: 405 }, (_, i) => ({
      _id: i % 2 ? new ObjectId() : `string-${i}`, customerId: new ObjectId(),
      updatedAt: new Date(0), revision: new Int32(7), hash: "unchanged",
      config: { nested: new Int32(11) },
    }));
    seed(db, "qualification_milestones", documents);
    seed(db, "users", [{ _id: "already-owned", companyId: legacyCompanyId(), updatedAt: new Date(0) }]);
    const preOwned = db.ensure("users").documents[0];
    const indexes = raw({ indexes: db.ensure("qualification_milestones").indexes });
    const first = await backfillOwnership(asClient(client), asDb(db));
    expect(first.changed.qualification_milestones).toBe(405);
    expect(client.batchSizes).toEqual([200, 200, 5]);
    expect(first.inventory.collections.find((entry) => entry.name === "qualification_milestones")?.missing).toBe(0);
    const originals = new Map(documents.map((document) => [identity(document._id), raw(document)]));
    for (const bytes of db.ensure("qualification_milestones").documents) {
      const document = decode(bytes);
      expect(document.companyId.equals(legacyCompanyId())).toBe(true);
      delete document.companyId;
      expect(raw(document)).toEqual(originals.get(identity(document._id)));
    }
    expect(db.ensure("users").documents[0]).toEqual(preOwned);
    expect(raw({ indexes: db.ensure("qualification_milestones").indexes })).toEqual(indexes);
    const second = await backfillOwnership(asClient(client), asDb(db));
    expect(Object.values(second.changed).every((count) => count === 0)).toBe(true);
    expect(client.writes.every((entry) => entry.kind === "backfill")).toBe(true);
  });

  it("aborts the transaction if any business field changes, preserving the pre-transaction BSON", async () => {
    seed(db, "companies", [company()]);
    seed(db, "crm_customers", [{ _id: "a", updatedAt: new Date(0) }]);
    const before = db.ensure("crm_customers").documents[0];
    client.corruptBusinessField = true;
    await expect(backfillOwnership(asClient(client), asDb(db))).rejects.toThrow("Business BSON changed");
    expect(client.aborts).toBe(1);
    expect(db.ensure("crm_customers").documents).toEqual([before]);
  });

  it("retries the entire transaction and preserves a concurrently committed business update", async () => {
    seed(db, "companies", [company()]);
    seed(db, "crm_customers", [{ _id: "a", revision: new Int32(1) }]);
    client.retryOnce = true;
    client.externalChange = () => seed(db, "crm_customers", [{ _id: "a", revision: new Int32(2) }]);
    const result = await backfillOwnership(asClient(client), asDb(db));
    expect(result.changed.crm_customers).toBe(1);
    const document = decode(db.ensure("crm_customers").documents[0]);
    expect(document.revision.valueOf()).toBe(2);
    expect(document.companyId.equals(legacyCompanyId())).toBe(true);
  });

  it("rolls back the whole batch if guarded matched/modified counts disagree", async () => {
    seed(db, "companies", [company()]);
    seed(db, "users", [{ _id: "a" }, { _id: "b" }]);
    const before = [...db.ensure("users").documents];
    client.countMismatch = true;
    await expect(backfillOwnership(asClient(client), asDb(db))).rejects.toThrow("count mismatch");
    expect(client.aborts).toBe(1);
    expect(db.ensure("users").documents).toEqual(before);
  });

  it("refuses backfill without bootstrap or a non-snapshot-capable deployment", async () => {
    seed(db, "users", [{ _id: "a" }]);
    await expect(backfillOwnership(asClient(client), asDb(db))).rejects.toThrow("bootstrap");
    client.standalone = true;
    await expect(assertSnapshotSupport(asClient(client))).rejects.toThrow("replica set");
    expect(client.writes).toEqual([]);
  });

  it("CLI help/invalid artifacts cannot connect; confirmation is never automatic", async () => {
    const connect = vi.spyOn(MongoClient.prototype, "connect").mockRejectedValue(new Error("No network permitted"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("MONGODB_URI", "mongodb://offline-test.invalid");
    vi.stubEnv("COMPANY_MIGRATION_BACKUP_KEY", key.toString("base64"));
    await main(["--help"]);
    await expect(main(["apply", "--backup", "relative", "--receipt", "relative"])).rejects.toThrow("absolute");
    await expect(main(["restore-test", "--backup", "relative", "--receipt", "relative"])).rejects.toThrow("absolute");
    await expect(main(["apply"])).rejects.toThrow("--backup");
    expect(connect).not.toHaveBeenCalled();
  });

  it("CLI bootstrap/apply require authentic proof and exact confirmation before any connection", async () => {
    const folder = path.join(process.cwd(), `.company-cli-test-${randomBytes(8).toString("hex")}`);
    await mkdir(folder);
    try {
      const filename = path.join(folder, "backup.aes");
      const receipt = path.join(folder, "receipt.json");
      seed(db, "users", [{ _id: "a" }]);
      await backupDatabase(asClient(client), asDb(db), filename, key, fingerprint);
      await writeFile(receipt, JSON.stringify({ verified: true }));
      // Filesystem confinement is tested separately; no test files may be written outside cwd.
      vi.spyOn(safety, "externalPath").mockImplementation(async (filename) => filename);
      const connect = vi.spyOn(MongoClient.prototype, "connect").mockRejectedValue(new Error("No network permitted"));
      vi.stubEnv("MONGODB_URI", "mongodb://offline-test.invalid");
      vi.stubEnv("COMPANY_MIGRATION_BACKUP_KEY", key.toString("base64"));
      const common = ["--backup", filename, "--receipt", receipt];
      for (const command of ["bootstrap", "apply"]) {
        await expect(main([command, ...common])).rejects.toThrow("confirm-production");
        await expect(main([command, ...common, "--confirm-production",
          "ai_secretary:9b9d1f4b4f16cf6e84abcce4"])).rejects.toThrow("cli.proof-validation");
      }
      expect(connect).not.toHaveBeenCalled();
      expect(client.writes).toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe("actual restore/rehearsal orchestration on an isolated driver double", () => {
  let folder: string;
  beforeEach(async () => {
    folder = path.join(process.cwd(), `.company-restore-test-${randomBytes(8).toString("hex")}`);
    await mkdir(folder);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true });
  });

  it("uses one snapshot for backup; restores/hash-verifies BSON, skips TTL, rehearses twice, and drops only its new database", async () => {
    const client = new FakeClient();
    const db = client.db("ai_secretary");
    seed(db, "users", [{ _id: "string-id", value: new Int32(1) }, { _id: new ObjectId(), value: new Int32(2) }]);
    seed(db, "qualification_milestones", [{ _id: "orphan", customerId: new ObjectId() }]);
    seed(db, "ai_task_calls", [{ _id: "expired", expiresAt: new Date(0) }]);
    db.ensure("users").indexes.push({
      v: new Int32(2), key: { value: new Int32(1) }, name: "value_1", unique: true,
    });
    db.ensure("ai_task_calls").indexes.push({
      v: new Int32(2), key: { expiresAt: new Int32(1) }, name: "expiresAt_1", expireAfterSeconds: new Int32(0),
    });
    const original = raw({ documents: [...db.stores].map(([name, store]) => ({ name, bytes: store.documents })) });
    const filename = path.join(folder, "backup.aes");
    const summary = await backupDatabase(asClient(client), asDb(db), filename, key, fingerprint);
    const snapshotReads = [...client.reads];
    expect(new Set(snapshotReads.map((read) => read.options.session)).size).toBe(1);
    expect(snapshotReads.every((read) => read.options.raw && read.options.promoteValues === false &&
      read.options.promoteLongs === false)).toBe(true);
    expect(client.sessionOptions).toEqual([{ snapshot: true }]);
    expect(client.writes).toEqual([]);
    const result = await restoreAndRehearse(asClient(client), filename, key, "ai_secretary", fingerprint);
    // Atlas shared tiers permit at most 38 UTF-8 bytes; retain all 128 random bits.
    expect(Buffer.byteLength(result.isolatedDatabase, "utf8")).toBe(36);
    expect(Buffer.byteLength(result.isolatedDatabase, "utf8")).toBeLessThanOrEqual(38);
    expect(result.isolatedDatabase).toMatch(/^cmr_[a-f0-9]{32}$/);
    expect(result.summary.backupSha256).toBe(summary.backupSha256);
    expect(result.ttlIndexesSkipped).toBe(1);
    expect(makeReceipt(result.summary).restoredDocuments).toBe(4);
    expect(client.dropped).toEqual([result.isolatedDatabase]);
    expect(client.databases.has(result.isolatedDatabase)).toBe(false);
    expect(client.writes.every((entry) => entry.db === result.isolatedDatabase)).toBe(true);
    expect(client.writes.filter((entry) => entry.kind === "index")
      .every((entry) => !Object.hasOwn(entry.index!, "expireAfterSeconds"))).toBe(true);
    expect(raw({ documents: [...db.stores].map(([name, store]) => ({ name, bytes: store.documents })) })).toEqual(original);
    expect((await readArchive(filename, key)).header.definitions
      .find((entry) => entry.definition.name === "ai_task_calls")?.indexes[1].expireAfterSeconds.valueOf()).toBe(0);
  });

  it("rejects wrong source binding and wrong key before creating any database/marker", async () => {
    const client = new FakeClient();
    const db = client.db("ai_secretary");
    seed(db, "users", [{ _id: "a" }]);
    const filename = path.join(folder, "backup.aes");
    await backupDatabase(asClient(client), asDb(db), filename, key, fingerprint);
    await expect(restoreAndRehearse(asClient(client), filename, key, "other", fingerprint)).rejects.toThrow("binding");
    await expect(restoreAndRehearse(asClient(client), filename, Buffer.alloc(32, 4),
      "ai_secretary", fingerprint)).rejects.toThrow("restore.archive-validation");
    expect(client.writes).toEqual([]);
    expect(client.dropped).toEqual([]);
  });

  it("cleans up only its marked isolated database on rehearsal failure and issues no successful result", async () => {
    const client = new FakeClient();
    const db = client.db("ai_secretary");
    seed(db, "users", [{ _id: "a", updatedAt: new Date(0) }]);
    const filename = path.join(folder, "backup.aes");
    await backupDatabase(asClient(client), asDb(db), filename, key, fingerprint);
    client.corruptBusinessField = true;
    await expect(restoreAndRehearse(asClient(client), filename, key, "ai_secretary", fingerprint)).rejects.toThrow();
    expect(client.dropped).toHaveLength(1);
    expect(client.dropped[0]).toMatch(/^cmr_[a-f0-9]{32}$/);
    expect(client.dropped).not.toContain("ai_secretary");
    expect(db.stores.has(RESTORE_GUARD_COLLECTION)).toBe(false);
  });

  it("refuses an already-existing restore database without touching or dropping it", async () => {
    const client = new FakeClient();
    const db = client.db("ai_secretary");
    seed(db, "users", [{ _id: "a" }]);
    const filename = path.join(folder, "backup.aes");
    await backupDatabase(asClient(client), asDb(db), filename, key, fingerprint);
    vi.spyOn(client.db("admin"), "admin").mockReturnValue({
      listDatabases: async () => ({ databases: [{ name: "existing" }] }),
    });
    await expect(restoreAndRehearse(asClient(client), filename, key, "ai_secretary", fingerprint))
      .rejects.toThrow("restore.database-availability");
    expect(client.writes).toEqual([]);
    expect(client.dropped).toEqual([]);
  });

  it("preserves a precise Mongo failure stage through replay and confirms scratch cleanup without leaking raw errors", async () => {
    const client = new FakeClient();
    seed(client.db("ai_secretary"), "users", [{ _id: "a" }]);
    const filename = path.join(folder, "backup.aes");
    await backupDatabase(asClient(client), asDb(client.db("ai_secretary")), filename, key, fingerprint);
    const secret = "private-record mongodb://user:password@host private-key";
    vi.spyOn(FakeCollection.prototype, "insertMany").mockRejectedValue(
      Object.assign(new Error(secret), { code: 11000, codeName: "DuplicateKey", keyValue: { secret } }),
    );
    const error = await restoreAndRehearse(asClient(client), filename, key, "ai_secretary", fingerprint)
      .catch((error) => error);
    const output = formatDiagnostic(error);
    expect(JSON.parse(output)).toMatchObject({
      stage: "restore.document-insert", safetyErrorId: "CM_RESTORE_DOCUMENT_INSERT",
      mongoCode: 11000, mongoCodeName: "DuplicateKey",
      restore: { scratchDatabasePrefix: "cmr_", cleanup: "confirmed" },
      recoveryGate: "closed",
    });
    expect(output).not.toContain(secret);
    expect(output).not.toContain("password");
    expect(client.dropped).toHaveLength(1);
    expect(client.dropped[0]).toMatch(/^cmr_[a-f0-9]{32}$/);
  });

  it("reports unconfirmed cleanup when marker insertion fails; never drops an unmarked database", async () => {
    const client = new FakeClient();
    seed(client.db("ai_secretary"), "users", [{ _id: "a" }]);
    const filename = path.join(folder, "backup.aes");
    await backupDatabase(asClient(client), asDb(client.db("ai_secretary")), filename, key, fingerprint);
    vi.spyOn(FakeCollection.prototype, "insertOne").mockRejectedValue(
      Object.assign(new Error("private error"), { code: 2, codeName: "BadValue" }),
    );
    const error = await restoreAndRehearse(asClient(client), filename, key, "ai_secretary", fingerprint)
      .catch((error) => error);
    expect(JSON.parse(formatDiagnostic(error))).toMatchObject({
      stage: "restore.marker-insert", mongoCode: 2, mongoCodeName: "BadValue",
      restore: { scratchDatabasePrefix: "cmr_", cleanup: "not-confirmed" },
    });
    expect(client.dropped).toEqual([]);
  });

  it("reports cleanup failure and retains the original failure stage/code without emitting either raw message", async () => {
    const client = new FakeClient();
    seed(client.db("ai_secretary"), "users", [{ _id: "a" }]);
    const filename = path.join(folder, "backup.aes");
    await backupDatabase(asClient(client), asDb(client.db("ai_secretary")), filename, key, fingerprint);
    vi.spyOn(FakeCollection.prototype, "insertMany").mockRejectedValue(
      Object.assign(new Error("private insert message"), { code: 11000, codeName: "DuplicateKey" }),
    );
    vi.spyOn(FakeDatabase.prototype, "dropDatabase").mockRejectedValue(
      Object.assign(new Error("private cleanup message"), { code: 13, codeName: "Unauthorized" }),
    );
    const error = await restoreAndRehearse(asClient(client), filename, key, "ai_secretary", fingerprint)
      .catch((error) => error);
    const output = formatDiagnostic(error);
    expect(JSON.parse(output)).toMatchObject({
      stage: "restore.cleanup-drop", mongoCode: 13, mongoCodeName: "Unauthorized",
      priorFailure: { stage: "restore.document-insert", mongoCode: 11000, mongoCodeName: "DuplicateKey" },
      restore: { cleanup: "not-confirmed" },
    });
    expect(output).not.toContain("private");
    expect(client.dropped).toEqual([]);
  });
});
