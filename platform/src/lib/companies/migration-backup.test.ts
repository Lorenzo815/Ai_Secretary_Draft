import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BSON, Binary, BSONRegExp, Code, Decimal128, Double, Int32, Long, MaxKey, MinKey,
  ObjectId, Timestamp, type Document,
} from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_COMPANY_ID, legacyCompanyId } from "./ownership";
import {
  makeHeader, makeReceipt, readArchive, requireProof, verifyReceipt, writeArchive, writeReceipt,
} from "./migration-backup";
import {
  BSON_OPTIONS, assertCompany, assertConfirmation, assertDatabaseName, assertDefinitions, assertFieldOnlyChange,
  assertOwnership, assertRestoreDatabase, decode, externalPath, parseKey, sourceFingerprint,
  type CollectionDefinition,
} from "./migration-safety";

const key = Buffer.alloc(32, 9);
const fingerprint = sourceFingerprint("mongodb://mock.invalid", key);
const raw = (document: Document) => Buffer.from(BSON.serialize(document));
const definition: CollectionDefinition = {
  definition: { name: "crm_customers", type: "collection", options: {}, info: { readOnly: false } },
  indexes: [{ v: new Int32(2), key: { _id: new Int32(1) }, name: "_id_" }],
};

describe("encrypted company migration backup (offline)", () => {
  let folder: string;
  let archive: string;
  beforeEach(async () => {
    folder = path.join(process.cwd(), `.company-migration-test-${randomBytes(8).toString("hex")}`);
    await mkdir(folder);
    archive = path.join(folder, "backup.bson.aes");
  });
  afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

  async function create(documents: Buffer[] = [raw({ _id: "customer", value: "private-test-value" })]) {
    return writeArchive(archive, key, makeHeader("ai_secretary", fingerprint, [definition]),
      async function* () { yield* documents; }, async () => undefined);
  }

  it("round-trips exact BSON types, IDs, field order, timestamps, index metadata and count/hash manifest", async () => {
    const original = raw({
      _id: new ObjectId(), stringId: "string-id", int: new Int32(12),
      long: Long.fromString("9007199254740993"), double: new Double(7),
      negativeZero: new Double(-0), decimal: Decimal128.fromString("1.2300"),
      binary: new Binary(Buffer.from([0, 1, 255]), 0x80),
      timestamp: new Timestamp({ t: 15, i: 7 }), date: new Date("2020-01-01T00:00:00.123Z"),
      regex: new BSONRegExp("x", "imxs"), code: new Code("return x", { x: new Int32(2) }),
      min: new MinKey(), max: new MaxKey(), nullable: null, array: [new Int32(3), Long.ONE],
      nested: { companyId: null, updatedAt: new Date(0) },
    });
    const summary = await create([original]);
    const restored: Buffer[] = [];
    const read = await readArchive(archive, key, { document: async (_name, bytes) => { restored.push(bytes); } });
    expect(restored).toEqual([original]);
    expect(read.backupSha256).toBe(summary.backupSha256);
    expect(read.collections).toEqual(summary.collections);
    expect(read.collections[0].count).toBe(1);
    expect(BSON.serialize({ definitions: read.header.definitions })).toEqual(BSON.serialize({ definitions: [definition] }));
    const document = BSON.deserialize(restored[0], BSON_OPTIONS);
    expect(document.int).toBeInstanceOf(Int32);
    expect(document.long).toBeInstanceOf(Long);
    expect(document.double).toBeInstanceOf(Double);
    expect(decode(restored[0])._id).toBeInstanceOf(ObjectId);
    expect((await readFile(archive)).includes(Buffer.from("private-test-value"))).toBe(false);
  });

  it("does not expose plaintext and refuses to overwrite either archive or receipt", async () => {
    const summary = await create();
    expect((await readFile(archive)).includes(Buffer.from("private-test-value"))).toBe(false);
    await expect(create()).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readArchive(archive, key)).backupSha256).toBe(summary.backupSha256);
    const receipt = path.join(folder, "verified.json");
    await writeReceipt(receipt, makeReceipt(summary), key);
    await expect(writeReceipt(receipt, makeReceipt(summary), key)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it.each(["wrong-key", "ciphertext", "iv", "tag", "truncate", "append"])(
    "rejects an unauthenticated backup: %s", async (mode) => {
      await create();
      const bytes = await readFile(archive);
      if (mode === "ciphertext") bytes[50] ^= 1;
      if (mode === "iv") bytes[17] ^= 1;
      if (mode === "tag") bytes[bytes.length - 1] ^= 1;
      await writeFile(archive, mode === "truncate" ? bytes.subarray(0, bytes.length - 9) :
        mode === "append" ? Buffer.concat([bytes, Buffer.from([0])]) : bytes);
      await expect(readArchive(archive, mode === "wrong-key" ? Buffer.alloc(32, 8) : key))
        .rejects.toThrow("verification failed");
    },
  );

  it("removes incomplete artifacts when snapshot/catalog validation fails", async () => {
    await expect(writeArchive(archive, key, makeHeader("ai_secretary", fingerprint, [definition]),
      async function* () { yield raw({ _id: "a" }); },
      async () => { throw new Error("catalog changed"); })).rejects.toThrow("catalog changed");
    await expect(readFile(archive)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["E", "M"])("verifies the %s count/hash manifest even when encryption is authentic", async (type) => {
    await create();
    const encrypted = await readFile(archive);
    const prefixSize = Buffer.byteLength("COMPANY-BSON-001\n") + 12;
    const prefix = Buffer.from(encrypted.subarray(0, prefixSize));
    const decrypt = createDecipheriv("aes-256-gcm", key, prefix.subarray(prefixSize - 12));
    decrypt.setAAD(prefix);
    decrypt.setAuthTag(encrypted.subarray(-16));
    const plaintext = Buffer.concat([decrypt.update(encrypted.subarray(prefixSize, -16)), decrypt.final()]);
    let offset = 0;
    let changed: Buffer | undefined;
    while (offset < plaintext.length) {
      const size = plaintext.readUInt32LE(offset + 1);
      if (plaintext.toString("ascii", offset, offset + 1) === type) {
        const document = BSON.deserialize(plaintext.subarray(offset + 5, offset + 5 + size), BSON_OPTIONS);
        if (type === "E") document.count = new Int32(99);
        else document.collections[0].sha256 = "0".repeat(64);
        const replacement = raw(document);
        const framePrefix = Buffer.from(plaintext.subarray(offset, offset + 5));
        framePrefix.writeUInt32LE(replacement.length, 1);
        changed = Buffer.concat([plaintext.subarray(0, offset), framePrefix, replacement,
          plaintext.subarray(offset + 5 + size)]);
        break;
      }
      offset += 5 + size;
    }
    expect(changed).toBeDefined();
    randomBytes(12).copy(prefix, prefixSize - 12);
    const encrypt = createCipheriv("aes-256-gcm", key, prefix.subarray(prefixSize - 12));
    encrypt.setAAD(prefix);
    const ciphertext = Buffer.concat([encrypt.update(changed!), encrypt.final()]);
    await writeFile(archive, Buffer.concat([prefix, ciphertext, encrypt.getAuthTag()]));
    await expect(readArchive(archive, key)).rejects.toThrow("verification failed");
  });

  it("binds authenticated proof to actual archive bytes, company, database and source connection", async () => {
    const summary = await create();
    const receipt = path.join(folder, "receipt.json");
    await writeReceipt(receipt, makeReceipt(summary), key);
    const value = JSON.parse(await readFile(receipt, "utf8"));
    expect(verifyReceipt(value, summary, "ai_secretary", fingerprint, key).companyId).toBe(LEGACY_COMPANY_ID);
    await expect(requireProof(archive, receipt, key, "other", fingerprint)).rejects.toThrow("does not bind");
    await expect(requireProof(archive, receipt, key, "ai_secretary", "0".repeat(64))).rejects.toThrow("does not bind");
    expect(() => verifyReceipt(value, { ...summary, backupSha256: "0".repeat(64) },
      "ai_secretary", fingerprint, key)).toThrow("does not bind");
    value.receipt.companyId = new ObjectId().toHexString();
    expect(() => verifyReceipt(value, summary, "ai_secretary", fingerprint, key)).toThrow("authentication");
    await writeFile(receipt, JSON.stringify({ verified: true }));
    await expect(requireProof(archive, receipt, key, "ai_secretary", fingerprint)).rejects.toThrow("receipt");
  });

  it("requires absolute external paths, rejects repo paths and refuses existing output", async () => {
    await expect(externalPath("relative", folder, false)).rejects.toThrow("absolute local");
    await expect(externalPath(archive, process.cwd(), false)).rejects.toThrow("repository");
    const nestedRepository = path.join(folder, "repo");
    await mkdir(nestedRepository);
    expect(await externalPath(archive, nestedRepository, false)).toBe(archive);
    await create();
    await expect(externalPath(archive, nestedRepository, false)).rejects.toThrow("overwrite");
    expect(await externalPath(archive, nestedRepository, true)).toBe(archive);
  });
});

describe("fail-closed migration invariants", () => {
  it.each([null, undefined, "9b9d1f4b4f16cf6e84abcce4", new ObjectId(), 1, {}])(
    "rejects every ambiguous/conflicting ownership type", (companyId) => {
      expect(() => assertOwnership({ companyId })).toThrow("ownership");
    },
  );
  it("accepts only missing or matching ObjectId ownership", () => {
    expect(() => assertOwnership({ _id: "a" })).not.toThrow();
    expect(() => assertOwnership({ _id: "b", companyId: legacyCompanyId() })).not.toThrow();
  });
  it("refuses unknown collections, views, options, unfinished indexes, and isolation-enabled companies", () => {
    expect(() => assertDefinitions([{ ...definition, definition: {
      ...definition.definition, name: "unknown_business_data",
    } }])).toThrow("Unknown collection");
    expect(() => assertDefinitions([{ ...definition, definition: {
      ...definition.definition, type: "view",
    } }])).toThrow("ordinary");
    expect(() => assertDefinitions([{ ...definition, definition: {
      ...definition.definition, options: { validator: {} },
    } }])).toThrow("ordinary");
    expect(() => assertDefinitions([{ ...definition, indexes: [
      { name: "_id_", key: { _id: 1 }, buildUUID: "in-progress" },
    ] }])).toThrow("index");
    expect(() => assertCompany({
      _id: legacyCompanyId(), key: "legacy", name: "test", status: "active", isolationReady: true, createdAt: new Date(),
    })).toThrow("isolationReady");
  });
  it("permits exactly one additive field and rejects field/type/timestamp/revision/orphan mutations", () => {
    const document = { _id: "string-id", customerId: new ObjectId(), updatedAt: new Date(0),
      revision: new Int32(1), hash: "unaltered", config: { enabled: true } };
    const original = raw(document);
    expect(() => assertFieldOnlyChange(original, raw({ ...document, companyId: legacyCompanyId() }))).not.toThrow();
    for (const patch of [{ updatedAt: new Date(1) }, { revision: new Double(1) }, { hash: "changed" },
      { customerId: new ObjectId() }, { config: { enabled: false } }]) {
      expect(() => assertFieldOnlyChange(original, raw({
        ...document, ...patch, companyId: legacyCompanyId(),
      }))).toThrow("Business BSON changed");
    }
  });
  it("requires exact apply confirmation and unguessable isolated restore names", () => {
    expect(() => assertConfirmation("ai_secretary", undefined)).toThrow("confirm-production");
    expect(() => assertConfirmation("ai_secretary", "yes")).toThrow();
    expect(() => assertConfirmation("ai_secretary", `ai_secretary:${LEGACY_COMPANY_ID}`)).not.toThrow();
    for (const target of ["ai_secretary", "admin", "cmr_test", `cmr_${"a".repeat(31)}`,
      `company_restore_${"a".repeat(32)}`]) {
      expect(() => assertRestoreDatabase(target, "ai_secretary")).toThrow("isolated");
    }
    const isolated = `cmr_${"a".repeat(32)}`;
    expect(() => assertRestoreDatabase(isolated, "ai_secretary")).not.toThrow();
    expect(() => assertRestoreDatabase(isolated, isolated)).toThrow();
    expect(() => assertDatabaseName(isolated)).toThrow("protected source");
    expect(() => assertDatabaseName(`company_restore_${"a".repeat(32)}`)).toThrow("protected source");
  });
  it("requires a canonical 32-byte base64 encryption key", () => {
    expect(parseKey(key.toString("base64"))).toEqual(key);
    for (const invalid of [undefined, "", "a".repeat(44), key.toString("base64").replace("=", ""), Buffer.alloc(31).toString("base64")]) {
      expect(() => parseKey(invalid)).toThrow();
    }
  });
});
