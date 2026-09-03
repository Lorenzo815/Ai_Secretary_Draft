import "server-only";

import { ObjectId, type Collection } from "mongodb";
import clientPromise from "../mongodb";
import type { AutomationEvent, AutomationJobDocument, AutomationProcessKey } from "./contracts";

const DB_NAME = "ai_secretary";

async function getCollection(): Promise<Collection<AutomationJobDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AutomationJobDocument>("automation_jobs");
}

export async function scheduleAutomationJob(input: {
  process: AutomationProcessKey;
  event: AutomationEvent;
  debounceMs: number;
}) {
  const collection = await getCollection();
  await ensureIndexes();
  const now = new Date();
  const dueAt = new Date(now.getTime() + input.debounceMs);
  await collection.updateOne(
    { process: input.process, customerId: input.event.customerId },
    [{
      $set: {
        _id: { $ifNull: ["$_id", new ObjectId()] },
        process: { $ifNull: ["$process", input.process] },
        customerId: { $ifNull: ["$customerId", input.event.customerId] },
        event: input.event.type,
        eventPayload: input.event.payload,
        status: { $cond: [{ $eq: ["$status", "processing"] }, "processing", "pending"] },
        revision: { $add: [{ $ifNull: ["$revision", 0] }, 1] },
        dueAt,
        latestEventAt: input.event.occurredAt,
        consecutiveFailures: 0,
        lastError: "$$REMOVE",
        createdAt: { $ifNull: ["$createdAt", now] },
        updatedAt: now,
      },
    }],
    { upsert: true },
  );
}

export async function claimAutomationJob(leaseMs: number, process?: AutomationProcessKey) {
  const collection = await getCollection();
  await ensureIndexes();
  const now = new Date();
  return collection.findOneAndUpdate(
    {
      ...(process ? { process } : {}),
      $or: [
        { status: "pending", dueAt: { $lte: now } },
        { status: "processing", leaseUntil: { $lte: now } },
      ],
    },
    { $set: { status: "processing", leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now } },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  );
}

export async function isAutomationJobCurrent(jobId: ObjectId, revision: number) {
  return Boolean(await (await getCollection()).findOne({ _id: jobId, revision, status: "processing" }));
}

export async function completeAutomationJob(jobId: ObjectId, revision: number) {
  const collection = await getCollection();
  const result = await collection.deleteOne({ _id: jobId, revision, status: "processing" });
  if (result.deletedCount === 0) {
    await collection.updateOne(
      { _id: jobId, status: "processing" },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
    );
  }
}

export async function failAutomationJob(job: AutomationJobDocument, error: unknown) {
  const collection = await getCollection();
  const failures = job.consecutiveFailures + 1;
  const retryDelayMs = Math.min(60_000 * 2 ** (failures - 1), 30 * 60_000);
  const result = await collection.updateOne(
    { _id: job._id, revision: job.revision, status: "processing" },
    {
      $set: {
        status: failures >= 5 ? "failed" : "pending",
        dueAt: new Date(Date.now() + retryDelayMs),
        consecutiveFailures: failures,
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido",
        updatedAt: new Date(),
      },
      $unset: { leaseUntil: "" },
    },
  );
  if (result.matchedCount === 0) {
    await collection.updateOne(
      { _id: job._id, status: "processing" },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
    );
  }
}

async function ensureIndexes() {
  const collection = await getCollection();
  await Promise.all([
    collection.createIndex({ process: 1, customerId: 1 }, { unique: true }),
    collection.createIndex({ status: 1, dueAt: 1 }),
    collection.createIndex({ status: 1, leaseUntil: 1 }),
  ]);
}