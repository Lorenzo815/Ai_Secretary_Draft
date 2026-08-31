import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { getDebounceMs } from "./config";

type JobStatus = "pending" | "processing" | "failed";

export interface AssistantJobDocument {
  _id: ObjectId;
  customerId: ObjectId;
  status: JobStatus;
  revision: number;
  dueAt: Date;
  latestInboundAt: Date;
  leaseUntil?: Date;
  consecutiveFailures: number;
  lastError?: string;
  triggerContext?: string;
  followUpTriggerId?: ObjectId;
  targetContactPhone?: string;
  targetContactName?: string;
  targetMessageSource?: "meta" | "simulator";
  createdAt: Date;
  updatedAt: Date;
}

const DB_NAME = "ai_secretary";

async function getJobsCollection(): Promise<Collection<AssistantJobDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AssistantJobDocument>("assistant_response_jobs");
}

export async function scheduleAssistantResponse(input: {
  customerId: ObjectId;
  latestInboundAt: Date;
  triggerContext?: string;
  followUpTriggerId?: ObjectId;
  targetContactPhone?: string;
  targetContactName?: string;
  targetMessageSource?: "meta" | "simulator";
}) {
  const jobs = await getJobsCollection();
  await ensureAssistantJobIndexes();
  const now = new Date();
  const dueAt = new Date(now.getTime() + getDebounceMs());

  await jobs.updateOne(
    { customerId: input.customerId },
    [
      {
        $set: {
          _id: { $ifNull: ["$_id", new ObjectId()] },
          customerId: { $ifNull: ["$customerId", input.customerId] },
          status: {
            $cond: [{ $eq: ["$status", "processing"] }, "processing", "pending"],
          },
          revision: { $add: [{ $ifNull: ["$revision", 0] }, 1] },
          dueAt,
          latestInboundAt: input.latestInboundAt,
          triggerContext: input.triggerContext ?? "$$REMOVE",
          followUpTriggerId: input.followUpTriggerId ?? "$$REMOVE",
          targetContactPhone: input.targetContactPhone ?? "$$REMOVE",
          targetContactName: input.targetContactName ?? "$$REMOVE",
          targetMessageSource: input.targetMessageSource ?? "$$REMOVE",
          consecutiveFailures: 0,
          lastError: "$$REMOVE",
          createdAt: { $ifNull: ["$createdAt", now] },
          updatedAt: now,
        },
      },
    ],
    { upsert: true },
  );
}

export async function claimAssistantJob(leaseMs: number) {
  const jobs = await getJobsCollection();
  await ensureAssistantJobIndexes();
  const now = new Date();

  return jobs.findOneAndUpdate(
    {
      $or: [
        { status: "pending", dueAt: { $lte: now } },
        { status: "processing", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseUntil: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      },
    },
    { sort: { dueAt: 1 }, returnDocument: "after" },
  );
}

export async function isAssistantJobRevisionCurrent(jobId: ObjectId, revision: number) {
  const jobs = await getJobsCollection();
  return Boolean(await jobs.findOne({ _id: jobId, revision, status: "processing" }));
}

export async function completeAssistantJob(jobId: ObjectId, revision: number) {
  const jobs = await getJobsCollection();
  const deleted = await jobs.deleteOne({ _id: jobId, revision, status: "processing" });
  if (deleted.deletedCount === 0) {
    await jobs.updateOne(
      { _id: jobId, status: "processing" },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
    );
  }
}

export async function failAssistantJob(job: AssistantJobDocument, error: unknown) {
  const jobs = await getJobsCollection();
  const failures = job.consecutiveFailures + 1;
  const retryDelayMs = Math.min(60_000 * 2 ** (failures - 1), 30 * 60_000);
  const updated = await jobs.updateOne(
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
  if (updated.matchedCount === 0) {
    await jobs.updateOne(
      { _id: job._id, status: "processing" },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { leaseUntil: "" } },
    );
  }
}

async function ensureAssistantJobIndexes() {
  const jobs = await getJobsCollection();
  await Promise.all([
    jobs.createIndex({ customerId: 1 }, { unique: true }),
    jobs.createIndex({ status: 1, dueAt: 1 }),
    jobs.createIndex({ status: 1, leaseUntil: 1 }),
  ]);
}