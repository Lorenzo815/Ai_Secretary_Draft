import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { BSON, type Document } from "mongodb";
import { LEGACY_COMPANY_ID } from "./ownership";
import {
  BSON_OPTIONS, MigrationSafetyError, assertCompany, assertDatabaseName, assertDefinitions,
  assertOwnership, collectionName, decode, equalMac, requireSafe,
  type CollectionDefinition,
} from "./migration-safety";

const MAGIC = Buffer.from("COMPANY-BSON-001\n", "ascii");
const MAX_FRAME = 16 * 1024 * 1024;
const FORMAT = "company-ownership-backup-v1";
const PROOF_FORMAT = "company-ownership-restore-proof-v1";

export interface BackupHeader {
  format: typeof FORMAT;
  database: string;
  companyId: string;
  sourceFingerprint: string;
  createdAt: Date;
  definitions: CollectionDefinition[];
}

export interface CollectionManifest {
  name: string;
  count: number;
  sha256: string;
}

export interface ArchiveSummary {
  header: BackupHeader;
  collections: CollectionManifest[];
  backupSha256: string;
}

interface ArchiveCallbacks {
  header?: (header: BackupHeader) => Promise<void>;
  collection?: (definition: CollectionDefinition) => Promise<void>;
  document?: (name: string, raw: Buffer) => Promise<void>;
  endCollection?: (manifest: CollectionManifest) => Promise<void>;
}

function frame(type: string, payload: Buffer): Buffer {
  requireSafe(payload.length <= MAX_FRAME, "Backup frame exceeds the BSON limit.");
  const prefix = Buffer.alloc(5);
  prefix.write(type, 0, "ascii");
  prefix.writeUInt32LE(payload.length, 1);
  return Buffer.concat([prefix, payload]);
}

function numeric(value: unknown): number {
  const number = typeof value === "number" ? value :
    value && typeof value === "object" && "valueOf" in value ? Number(value.valueOf()) : NaN;
  requireSafe(Number.isSafeInteger(number) && number >= 0, "Invalid archive count.");
  return number;
}

function unpackManifest(value: Document): CollectionManifest {
  requireSafe(typeof value.name === "string" && /^[a-f0-9]{64}$/.test(value.sha256),
    "Invalid collection manifest.");
  return { name: value.name, count: numeric(value.count), sha256: value.sha256 };
}

export function makeHeader(
  database: string,
  fingerprint: string,
  definitions: CollectionDefinition[],
): BackupHeader {
  assertDatabaseName(database);
  assertDefinitions(definitions);
  return {
    format: FORMAT, database, companyId: LEGACY_COMPANY_ID,
    sourceFingerprint: fingerprint, createdAt: new Date(), definitions,
  };
}

export async function writeArchive(
  filename: string,
  key: Buffer,
  header: BackupHeader,
  documents: (name: string) => AsyncIterable<Buffer>,
  beforeFinish: () => Promise<void>,
): Promise<ArchiveSummary> {
  assertDefinitions(header.definitions);
  let file: FileHandle | undefined;
  try {
    file = await open(filename, "wx", 0o600);
    const iv = randomBytes(12);
    const encrypt = createCipheriv("aes-256-gcm", key, iv);
    const prefix = Buffer.concat([MAGIC, iv]);
    encrypt.setAAD(prefix);
    const hash = createHash("sha256");
    const write = async (bytes: Buffer) => {
      hash.update(bytes);
      await file!.writeFile(bytes);
    };
    const record = async (type: string, value: Document | Buffer) => {
      await write(encrypt.update(frame(type, Buffer.isBuffer(value) ? value : Buffer.from(BSON.serialize(value)))));
    };
    await write(prefix);
    await record("H", header);
    const collections: CollectionManifest[] = [];
    for (const definition of header.definitions) {
      const name = collectionName(definition);
      await record("C", { name });
      const collectionHash = createHash("sha256");
      let count = 0;
      for await (const raw of documents(name)) {
        const document = decode(raw);
        if (name === "companies") {
          assertCompany(document);
          requireSafe(count === 0, "A second company is not supported.");
        } else assertOwnership(document);
        collectionHash.update(raw);
        count++;
        await record("D", raw);
      }
      const manifest = { name, count, sha256: collectionHash.digest("hex") };
      collections.push(manifest);
      await record("E", manifest);
    }
    await beforeFinish();
    await record("M", { collections });
    await write(encrypt.final());
    await write(encrypt.getAuthTag());
    await file.sync();
    await file.close();
    file = undefined;
    return { header, collections, backupSha256: hash.digest("hex") };
  } catch (error) {
    if (file) {
      await file.close().catch(() => undefined);
      await unlink(filename).catch(() => undefined);
    }
    throw error;
  }
}

async function* plaintext(file: FileHandle, key: Buffer, hash: ReturnType<typeof createHash>) {
  const size = (await file.stat()).size;
  requireSafe(size >= MAGIC.length + 12 + 16 + 5, "Truncated encrypted archive.");
  const prefix = Buffer.alloc(MAGIC.length + 12);
  requireSafe((await file.read(prefix, 0, prefix.length, 0)).bytesRead === prefix.length,
    "Truncated archive prefix.");
  requireSafe(prefix.subarray(0, MAGIC.length).equals(MAGIC), "Unknown archive format.");
  const tag = Buffer.alloc(16);
  requireSafe((await file.read(tag, 0, 16, size - 16)).bytesRead === 16, "Missing authentication tag.");
  const decipher = createDecipheriv("aes-256-gcm", key, prefix.subarray(MAGIC.length));
  decipher.setAAD(prefix);
  decipher.setAuthTag(tag);
  hash.update(prefix);
  const input = file.createReadStream({ start: prefix.length, end: size - 17, autoClose: false });
  for await (const part of input) {
    const bytes = part as Buffer;
    hash.update(bytes);
    const decrypted = decipher.update(bytes);
    if (decrypted.length) yield decrypted;
  }
  const final = decipher.final();
  if (final.length) yield final;
  hash.update(tag);
}

async function* frames(chunks: AsyncIterable<Buffer>) {
  const iterator = chunks[Symbol.asyncIterator]();
  let current: Buffer = Buffer.alloc(0);
  async function exact(length: number, eof = false): Promise<Buffer | undefined> {
    const pieces: Buffer[] = [];
    let remaining = length;
    while (remaining) {
      if (!current.length) {
        const next = await iterator.next();
        if (next.done) {
          requireSafe(eof && remaining === length, "Truncated backup frame.");
          return undefined;
        }
        current = next.value;
      }
      const taken = Math.min(remaining, current.length);
      pieces.push(current.subarray(0, taken));
      current = current.subarray(taken);
      remaining -= taken;
    }
    return Buffer.concat(pieces, length);
  }
  try {
    while (true) {
      const prefix = await exact(5, true);
      if (!prefix) return;
      const size = prefix.readUInt32LE(1);
      requireSafe(size >= 5 && size <= MAX_FRAME, "Invalid backup frame size.");
      yield { type: prefix.toString("ascii", 0, 1), raw: (await exact(size))! };
    }
  } finally {
    await iterator.return?.();
  }
}

/**
 * Consumers must exhaust the archive: AES-GCM authenticates at EOF. Only isolated
 * restore-test callbacks may write before that point; production proof checking has no callbacks.
 */
export async function readArchive(
  filename: string,
  key: Buffer,
  callbacks: ArchiveCallbacks = {},
): Promise<ArchiveSummary> {
  const file = await open(filename, "r");
  try {
    const hash = createHash("sha256");
    const iterator = frames(plaintext(file, key, hash))[Symbol.asyncIterator]();
    try {
      const next = async (type: string) => {
        const record = await iterator.next();
        requireSafe(!record.done && record.value.type === type, "Unexpected backup record.");
        return record.value.raw;
      };
      const header = BSON.deserialize(await next("H"), BSON_OPTIONS) as BackupHeader;
      requireSafe(header.format === FORMAT && header.companyId === LEGACY_COMPANY_ID &&
        /^[a-f0-9]{64}$/.test(header.sourceFingerprint) &&
        header.createdAt instanceof Date && Number.isFinite(header.createdAt.getTime()) &&
        Array.isArray(header.definitions), "Invalid backup header.");
      assertDatabaseName(header.database);
      assertDefinitions(header.definitions);
      await callbacks.header?.(header);
      const collections: CollectionManifest[] = [];
      for (const definition of header.definitions) {
        const name = collectionName(definition);
        requireSafe(BSON.deserialize(await next("C"), BSON_OPTIONS).name === name,
          "Collection order mismatch.");
        await callbacks.collection?.(definition);
        const collectionHash = createHash("sha256");
        let count = 0;
        let ending: Document | undefined;
        while (true) {
          const record = await iterator.next();
          requireSafe(!record.done, "Missing collection terminator.");
          if (record.value.type === "E") {
            ending = BSON.deserialize(record.value.raw, BSON_OPTIONS);
            break;
          }
          requireSafe(record.value.type === "D", "Unexpected document record.");
          const raw = record.value.raw;
          const document = decode(raw);
          if (name === "companies") {
            assertCompany(document);
            requireSafe(count === 0, "A second company is not supported.");
          } else assertOwnership(document);
          count++;
          collectionHash.update(raw);
          await callbacks.document?.(name, raw);
        }
        const expected = unpackManifest(ending);
        const actual = { name, count, sha256: collectionHash.digest("hex") };
        requireSafe(JSON.stringify(actual) === JSON.stringify(expected), "Collection hash/count mismatch.");
        collections.push(actual);
        await callbacks.endCollection?.(actual);
      }
      const manifest = BSON.deserialize(await next("M"), BSON_OPTIONS);
      requireSafe(Array.isArray(manifest.collections) &&
        JSON.stringify(manifest.collections.map(unpackManifest)) === JSON.stringify(collections),
      "Archive manifest mismatch.");
      requireSafe((await iterator.next()).done, "Trailing backup records.");
      return { header, collections, backupSha256: hash.digest("hex") };
    } finally {
      await iterator.return?.();
    }
  } catch (error) {
    throw new MigrationSafetyError("Backup authentication, BSON fidelity, or manifest verification failed.", { cause: error });
  } finally {
    await file.close();
  }
}

export interface VerificationReceipt {
  format: typeof PROOF_FORMAT;
  backupSha256: string;
  database: string;
  companyId: string;
  sourceFingerprint: string;
  completedAt: string;
  restoredDocuments: number;
  checks: "bson-count-hash-indexes-migration-idempotence-cleanup";
}

export function makeReceipt(summary: ArchiveSummary): VerificationReceipt {
  return {
    format: PROOF_FORMAT,
    backupSha256: summary.backupSha256,
    database: summary.header.database,
    companyId: summary.header.companyId,
    sourceFingerprint: summary.header.sourceFingerprint,
    completedAt: new Date().toISOString(),
    restoredDocuments: summary.collections.reduce((total, item) => total + item.count, 0),
    checks: "bson-count-hash-indexes-migration-idempotence-cleanup",
  };
}

function receiptMac(receipt: VerificationReceipt, key: Buffer): string {
  return createHmac("sha256", key).update("company-restore-proof-v1\0")
    .update(JSON.stringify(receipt)).digest("hex");
}

export async function writeReceipt(filename: string, receipt: VerificationReceipt, key: Buffer) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ receipt, mac: receiptMac(receipt, key) }));
    await file.sync();
  } finally {
    await file.close();
  }
}

export function verifyReceipt(
  value: unknown,
  summary: ArchiveSummary,
  database: string,
  fingerprint: string,
  key: Buffer,
): VerificationReceipt {
  requireSafe(value && typeof value === "object" && "receipt" in value && "mac" in value,
    "Missing restore verification receipt.");
  const { receipt, mac } = value as { receipt: VerificationReceipt; mac: string };
  requireSafe(receipt && typeof mac === "string" && equalMac(mac, receiptMac(receipt, key)),
    "Restore receipt authentication failed.");
  requireSafe(receipt.format === PROOF_FORMAT &&
    receipt.checks === "bson-count-hash-indexes-migration-idempotence-cleanup" &&
    receipt.database === database && summary.header.database === database &&
    receipt.sourceFingerprint === fingerprint && summary.header.sourceFingerprint === fingerprint &&
    receipt.companyId === LEGACY_COMPANY_ID && receipt.companyId === summary.header.companyId &&
    receipt.backupSha256 === summary.backupSha256 &&
    receipt.restoredDocuments === summary.collections.reduce((total, item) => total + item.count, 0) &&
    Number.isFinite(Date.parse(receipt.completedAt)) &&
    Date.parse(receipt.completedAt) >= summary.header.createdAt.getTime() &&
    Date.parse(receipt.completedAt) <= Date.now() + 60_000,
  "Restore receipt does not bind this backup, database, company, and connection.");
  return receipt;
}

export async function requireProof(
  backup: string,
  receipt: string,
  key: Buffer,
  database: string,
  fingerprint: string,
): Promise<VerificationReceipt> {
  const summary = await readArchive(backup, key);
  let value: unknown;
  try {
    const text = await readFile(receipt, "utf8");
    requireSafe(text.length < 16_384, "Oversized receipt.");
    value = JSON.parse(text);
  } catch {
    throw new MigrationSafetyError("Cannot read restore verification receipt.");
  }
  return verifyReceipt(value, summary, database, fingerprint, key);
}
