import "server-only";

import { MongoServerError, ObjectId, type Collection } from "mongodb";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";
const LOCK_COLLECTION = "lead_qualification_locks";
const LOCK_LEASE_MS = 5 * 60_000;
let indexesPromise: Promise<unknown> | undefined;

interface QualificationLockDocument {
  _id: ObjectId;
  customerId: ObjectId;
  sourceHash: string;
  token: ObjectId;
  leaseUntil: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class QualificationInProgressError extends Error {
  readonly code = "QUALIFICATION_IN_PROGRESS";

  constructor() {
    super("Já existe uma análise em andamento para este cliente. Aguarde a conclusão antes de tentar novamente.");
    this.name = "QualificationInProgressError";
  }
}

export async function acquireQualificationLock(customerId: ObjectId, sourceHash: string) {
  const collection = await getCollection();
  await ensureIndexes(collection);
  const now = new Date();
  const token = new ObjectId();

  try {
    const lock = await collection.findOneAndUpdate(
      {
        customerId,
        $or: [
          { leaseUntil: { $lte: now } },
          { leaseUntil: { $exists: false } },
        ],
      },
      {
        $set: {
          sourceHash,
          token,
          leaseUntil: new Date(now.getTime() + LOCK_LEASE_MS),
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!lock || !lock.token.equals(token)) throw new QualificationInProgressError();
  } catch (error) {
    if (error instanceof QualificationInProgressError) throw error;
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new QualificationInProgressError();
    }
    throw error;
  }

  return async () => {
    await collection.deleteOne({ customerId, token });
  };
}

export async function getQualificationLockStatus(customerId: ObjectId) {
  const lock = await (await getCollection()).findOne(
    { customerId, leaseUntil: { $gt: new Date() } },
    { projection: { _id: 0, sourceHash: 1, leaseUntil: 1 } },
  );
  return lock
    ? { inProgress: true as const, sourceHash: lock.sourceHash, leaseUntil: lock.leaseUntil }
    : { inProgress: false as const };
}

async function getCollection(): Promise<Collection<QualificationLockDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<QualificationLockDocument>(LOCK_COLLECTION);
}

async function ensureIndexes(collection: Collection<QualificationLockDocument>) {
  indexesPromise ??= Promise.all([
    collection.createIndex({ customerId: 1 }, { unique: true }),
    collection.createIndex({ leaseUntil: 1 }, { expireAfterSeconds: 0 }),
  ]);
  await indexesPromise;
}