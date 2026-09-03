import "server-only";

import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";

interface JobRecord {
  _id: ObjectId;
  customerId: ObjectId;
  process: "customer_agent" | "lead_qualification";
  event: string;
  status: "pending" | "processing" | "failed";
  revision: number;
  consecutiveFailures: number;
  lastError?: string;
  dueAt: Date;
  updatedAt: Date;
}

interface RunRecord {
  _id: ObjectId;
  customerId: ObjectId;
  status: "running" | "completed" | "failed" | "superseded";
  configRevision: number;
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
  finalDecision?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

interface ModelCallRecord {
  _id: ObjectId;
  customerId?: ObjectId;
  taskKey: string;
  model: string;
  status: "started" | "completed" | "failed";
  durationMs?: number;
  finishReason?: string;
  errorName?: string;
  errorMessage?: string;
  startedAt: Date;
}

interface PaymentRecord {
  _id: ObjectId;
  customerId: ObjectId;
  amountCents: number;
  status: "awaiting_human_confirmation" | "paid" | "rejected";
  createdAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNote?: string;
}

export async function getOperationsDashboard() {
  const database = (await clientPromise).db(DB_NAME);
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const lastSevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);

  const [jobs, runs, modelCalls, payments, failedMessages, runStatuses] = await Promise.all([
    database.collection<JobRecord>("automation_jobs").find({}, {
      projection: { customerId: 1, process: 1, event: 1, status: 1, revision: 1, consecutiveFailures: 1, lastError: 1, dueAt: 1, updatedAt: 1 },
    }).sort({ updatedAt: -1 }).limit(30).toArray(),
    database.collection<RunRecord>("assistant_runs").find({}, {
      projection: { customerId: 1, status: 1, configRevision: 1, modelIterations: 1, toolExecutions: 1, mutationsExecuted: 1, finalDecision: 1, error: 1, startedAt: 1, completedAt: 1 },
    }).sort({ startedAt: -1 }).limit(30).toArray(),
    database.collection<ModelCallRecord>("ai_task_calls").find({}, {
      projection: { customerId: 1, taskKey: 1, model: 1, status: 1, durationMs: 1, finishReason: 1, errorName: 1, errorMessage: 1, startedAt: 1 },
    }).sort({ startedAt: -1 }).limit(30).toArray(),
    database.collection<PaymentRecord>("payment_requests").find({}, {
      projection: { customerId: 1, amountCents: 1, status: 1, createdAt: 1, reviewedAt: 1, reviewedBy: 1, reviewNote: 1 },
    }).sort({ createdAt: -1 }).limit(30).toArray(),
    database.collection("whatsapp_messages").countDocuments({ status: "failed", timestamp: { $gte: last24Hours } }),
    database.collection("assistant_runs").aggregate<{ _id: string; count: number }>([
      { $match: { startedAt: { $gte: lastSevenDays } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const customerIds = new Set<string>();
  for (const record of [...jobs, ...runs, ...modelCalls, ...payments]) {
    if (record.customerId) customerIds.add(record.customerId.toString());
  }
  const customers = await database.collection<{ _id: ObjectId; name: string }>("crm_customers").find(
    { _id: { $in: [...customerIds].map((id) => new ObjectId(id)) } },
    { projection: { name: 1 } },
  ).toArray();
  const customerNames = new Map(customers.map((customer) => [customer._id.toString(), customer.name]));
  const withCustomer = <RecordType extends { customerId?: ObjectId }>(record: RecordType) => ({
    ...record,
    customerName: record.customerId ? customerNames.get(record.customerId.toString()) ?? "Cliente removido" : "Tarefa de sistema",
  });
  const statusCounts = Object.fromEntries(runStatuses.map((status) => [status._id, status.count]));
  const completedRuns = Number(statusCounts.completed ?? 0);
  const failedRuns = Number(statusCounts.failed ?? 0);
  const finishedRuns = completedRuns + failedRuns;
  const completedCalls = modelCalls.filter((call) => call.status === "completed" && typeof call.durationMs === "number");

  return {
    generatedAt: now,
    health: {
      pendingJobs: jobs.filter((job) => job.status === "pending").length,
      processingJobs: jobs.filter((job) => job.status === "processing").length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      failedMessages,
      runSuccessRate: finishedRuns > 0 ? Math.round((completedRuns / finishedRuns) * 100) : 100,
      medianModelLatencyMs: median(completedCalls.map((call) => call.durationMs!)),
    },
    jobs: jobs.map(withCustomer),
    runs: runs.map(withCustomer),
    modelCalls: modelCalls.map(withCustomer),
    payments: payments.map(withCustomer),
  };
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}