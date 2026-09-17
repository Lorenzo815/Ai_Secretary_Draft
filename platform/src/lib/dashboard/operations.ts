import "server-only";

import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { estimateModelCallCostUsd, type ModelTokenPricing } from "../ai/model-cost";
import { normalizeModelUsage, type NormalizedModelUsage } from "../ai/model-usage";
import { listVercelLanguageModels, listVercelModelEndpoints } from "../ai/vercel-models";
import { getUsdBrlRate, type UsdBrlRate } from "../currency/usd-brl";

const DB_NAME = "ai_secretary";

interface JobRecord {
  _id: ObjectId;
  customerId: ObjectId;
  process: "customer_agent" | "customer_follow_up" | "lead_qualification";
  event: string;
  eventPayload?: Record<string, unknown>;
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
  provider?: "vercel" | "azure";
  model: string;
  inferenceProvider?: string | null;
  status: "started" | "completed" | "failed";
  durationMs?: number;
  finishReason?: string;
  errorName?: string;
  errorMessage?: string;
  usage?: unknown;
  normalizedUsage?: NormalizedModelUsage | null;
  startedAt: Date;
}

export async function getOperationsDashboard() {
  const database = (await clientPromise).db(DB_NAME);
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const lastSevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const last30Days = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1_000);
  const calendarSettings = await database.collection<{ _id: string; timezone?: string }>("calendar_settings").findOne(
    { _id: "default-calendar" },
    { projection: { timezone: 1 } },
  );
  const timezone = typeof calendarSettings?.timezone === "string"
    ? calendarSettings.timezone
    : "America/Sao_Paulo";

  const [jobs, runs, modelCalls, usageCalls, failedMessages, runStatuses, jobStatuses, latencyCalls] = await Promise.all([
    database.collection<JobRecord>("automation_jobs").find({}, {
      projection: { customerId: 1, process: 1, event: 1, eventPayload: 1, status: 1, revision: 1, consecutiveFailures: 1, lastError: 1, dueAt: 1, updatedAt: 1 },
    }).sort({ updatedAt: -1 }).limit(30).toArray(),
    database.collection<RunRecord>("assistant_runs").find({}, {
      projection: { customerId: 1, status: 1, configRevision: 1, modelIterations: 1, toolExecutions: 1, mutationsExecuted: 1, finalDecision: 1, error: 1, startedAt: 1, completedAt: 1 },
    }).sort({ startedAt: -1 }).limit(30).toArray(),
    database.collection<ModelCallRecord>("ai_task_calls").find({}, {
      projection: { customerId: 1, taskKey: 1, provider: 1, model: 1, inferenceProvider: 1, status: 1, durationMs: 1, finishReason: 1, errorName: 1, errorMessage: 1, usage: 1, normalizedUsage: 1, startedAt: 1 },
    }).sort({ startedAt: -1 }).limit(30).toArray(),
    database.collection<ModelCallRecord>("ai_task_calls").find(
      { status: "completed", startedAt: { $gte: last30Days } },
      { projection: { _id: 0, provider: 1, model: 1, inferenceProvider: 1, usage: 1, normalizedUsage: 1, startedAt: 1 } },
    ).sort({ startedAt: 1 }).toArray(),
    database.collection("whatsapp_messages").countDocuments({ status: "failed", timestamp: { $gte: last24Hours } }),
    database.collection("assistant_runs").aggregate<{ _id: string; count: number }>([
      { $match: { startedAt: { $gte: lastSevenDays } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("automation_jobs").aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection<ModelCallRecord>("ai_task_calls").find(
      { status: "completed", startedAt: { $gte: lastSevenDays } },
      { projection: { _id: 0, taskKey: 1, durationMs: 1 } },
    ).toArray(),
  ]);

  const customerIds = new Set<string>();
  for (const record of [...jobs, ...runs, ...modelCalls]) {
    if (record.customerId) customerIds.add(record.customerId.toString());
  }
  const customers = await database.collection<{ _id: ObjectId; name: string }>("crm_customers").find(
    { _id: { $in: [...customerIds].map((id) => new ObjectId(id)) } },
    { projection: { name: 1 } },
  ).toArray();
  const customerNames = new Map(customers.map((customer) => [customer._id.toString(), customer.name]));
  const [vercelPricing, usdBrlRate] = await Promise.all([
    loadVercelPricing([...modelCalls, ...usageCalls]),
    getUsdBrlRate(),
  ]);
  const withCustomer = <RecordType extends { customerId?: ObjectId }>(record: RecordType) => ({
    ...record,
    customerName: record.customerId ? customerNames.get(record.customerId.toString()) ?? "Cliente removido" : "Tarefa de sistema",
  });
  const statusCounts = Object.fromEntries(runStatuses.map((status) => [status._id, status.count]));
  const completedRuns = Number(statusCounts.completed ?? 0);
  const failedRuns = Number(statusCounts.failed ?? 0);
  const finishedRuns = completedRuns + failedRuns;
  const jobStatusCounts = Object.fromEntries(jobStatuses.map((status) => [status._id, status.count]));
  const agentLatencies = latencyCalls
    .filter((call) => call.taskKey === "customer_agent")
    .map((call) => call.durationMs!);
  const qualificationLatencies = latencyCalls
    .filter((call) => call.taskKey === "lead_qualification")
    .map((call) => call.durationMs!);
  const normalizedCalls = modelCalls.map((call) => ({
    ...call,
    normalizedUsage: call.normalizedUsage ?? normalizeModelUsage(call.usage),
    estimatedCostUsd: estimateModelCallCostUsd(
      call.normalizedUsage ?? normalizeModelUsage(call.usage),
      pricingForCall(call, vercelPricing),
    ),
    usage: undefined,
  }));

  return {
    generatedAt: now,
    health: {
      pendingJobs: Number(jobStatusCounts.pending ?? 0),
      processingJobs: Number(jobStatusCounts.processing ?? 0),
      failedJobs: Number(jobStatusCounts.failed ?? 0),
      failedMessages,
      completedRuns,
      finishedRuns,
      runSuccessRate: finishedRuns > 0 ? Math.round((completedRuns / finishedRuns) * 100) : null,
      agentLatency: summarizeLatency(agentLatencies),
      qualificationLatency: summarizeLatency(qualificationLatencies),
    },
    jobs: jobs.map(withCustomer),
    runs: runs.map(withCustomer),
    aiUsage: buildUsageSummary(now, timezone, usageCalls, vercelPricing, usdBrlRate),
    modelCalls: normalizedCalls.map(withCustomer),
  };
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function buildUsageSummary(
  now: Date,
  timezone: string,
  calls: ModelCallRecord[],
  vercelPricing: Map<string, ModelTokenPricing>,
  usdBrlRate?: UsdBrlRate,
) {
  const normalizedCalls = calls.flatMap((call) => {
    const usage = call.normalizedUsage ?? normalizeModelUsage(call.usage);
    return usage ? [{
      date: formatDateKey(call.startedAt, timezone),
      hour: formatHourKey(call.startedAt, timezone),
      model: call.model,
      providerId: providerIdForCall(call),
      usage,
      estimatedCostUsd: estimateModelCallCostUsd(usage, pricingForCall(call, vercelPricing)),
    }] : [];
  });
  const usages = normalizedCalls.map((call) => call.usage);
  const estimatedCosts = normalizedCalls.map((call) => call.estimatedCostUsd);
  const callsWithCacheData = usages.filter((usage) => usage.cachedInputTokens !== undefined && usage.inputTokens !== undefined);
  const cacheEligibleInputTokens = sumKnown(callsWithCacheData.map((usage) => usage.inputTokens));
  const cachedInputTokens = sumKnown(callsWithCacheData.map((usage) => usage.cachedInputTokens));
  const dailyUsage = new Map<string, { inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCostUsd: number }>();
  const hourlyUsage = new Map<string, { inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCostUsd: number }>();
  const groupedCalls = new Map<string, typeof normalizedCalls>();

  for (const call of normalizedCalls) {
    addUsage(dailyUsage, call.date, call.usage, call.estimatedCostUsd);
    addUsage(hourlyUsage, call.hour, call.usage, call.estimatedCostUsd);
    const groupKey = `${call.model.toLowerCase()}::${call.providerId.toLowerCase()}`;
    groupedCalls.set(groupKey, [...(groupedCalls.get(groupKey) ?? []), call]);
  }

  const estimatedCostUsd = sumKnown(estimatedCosts);

  return {
    periodDays: 30,
    calls: calls.length,
    callsWithUsage: normalizedCalls.length,
    callsWithEstimatedCost: estimatedCosts.filter((cost) => cost !== undefined).length,
    estimatedCostUsd,
    estimatedCostBrl: convertUsdToBrl(estimatedCostUsd, usdBrlRate),
    usdBrlRate,
    inputTokens: sumKnown(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumKnown(usages.map((usage) => usage.outputTokens)),
    totalTokens: sumKnown(usages.map((usage) => usage.totalTokens)),
    cachedInputTokens: sumKnown(usages.map((usage) => usage.cachedInputTokens)),
    cacheWriteInputTokens: sumKnown(usages.map((usage) => usage.cacheWriteInputTokens)),
    reasoningTokens: sumKnown(usages.map((usage) => usage.reasoningTokens)),
    cacheRate: cacheEligibleInputTokens && cachedInputTokens !== undefined
      ? Math.round((cachedInputTokens / cacheEligibleInputTokens) * 1_000) / 10
      : undefined,
    byModelProvider: [...groupedCalls.values()].map((group) => {
      const groupCosts = group.map((call) => call.estimatedCostUsd);
      const groupCostUsd = sumKnown(groupCosts);
      return {
        model: group[0].model,
        providerId: group[0].providerId,
        calls: group.length,
        callsWithEstimatedCost: groupCosts.filter((cost) => cost !== undefined).length,
        inputTokens: sumKnown(group.map((call) => call.usage.inputTokens)),
        cachedInputTokens: sumKnown(group.map((call) => call.usage.cachedInputTokens)),
        outputTokens: sumKnown(group.map((call) => call.usage.outputTokens)),
        estimatedCostUsd: groupCostUsd,
        estimatedCostBrl: convertUsdToBrl(groupCostUsd, usdBrlRate),
      };
    }).sort((left, right) => (
      (right.estimatedCostUsd ?? -1) - (left.estimatedCostUsd ?? -1)
      || right.calls - left.calls
      || left.model.localeCompare(right.model)
    )),
    hourly: Array.from({ length: 24 }, (_, index) => {
      const date = new Date(now.getTime() - (23 - index) * 60 * 60 * 1_000);
      const key = formatHourKey(date, timezone);
      return {
        date: key,
        label: new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date),
        ...(hourlyUsage.get(key) ?? emptyUsageBucket()),
      };
    }),
    daily: Array.from({ length: 30 }, (_, index) => {
      const date = new Date(now.getTime() - (29 - index) * 24 * 60 * 60 * 1_000);
      const key = formatDateKey(date, timezone);
      return {
        date: key,
        label: new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date),
        ...(dailyUsage.get(key) ?? emptyUsageBucket()),
      };
    }),
  };
}

function convertUsdToBrl(value: number | undefined, usdBrlRate?: UsdBrlRate) {
  return value === undefined || !usdBrlRate ? undefined : value * usdBrlRate.rate;
}

function addUsage(
  buckets: Map<string, ReturnType<typeof emptyUsageBucket>>,
  key: string,
  usage: NormalizedModelUsage,
  estimatedCostUsd?: number,
) {
  const current = buckets.get(key) ?? emptyUsageBucket();
  const cachedTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens ?? 0);
  current.inputTokens += Math.max((usage.inputTokens ?? 0) - cachedTokens, 0);
  current.cachedInputTokens += cachedTokens;
  current.outputTokens += usage.outputTokens ?? 0;
  current.estimatedCostUsd += estimatedCostUsd ?? 0;
  buckets.set(key, current);
}

function emptyUsageBucket() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

async function loadVercelPricing(calls: ModelCallRecord[]) {
  const vercelCalls = calls.filter(isVercelCall);
  const modelIds = [...new Set(vercelCalls.map((call) => call.model))];
  const modelsWithPinnedProvider = [...new Set(
    vercelCalls.filter((call) => call.inferenceProvider).map((call) => call.model),
  )];
  const pricing = new Map<string, ModelTokenPricing>();
  if (modelIds.length === 0) return pricing;

  const [catalogResult, ...endpointResults] = await Promise.allSettled([
    listVercelLanguageModels(),
    ...modelsWithPinnedProvider.map((modelId) => listVercelModelEndpoints(modelId)),
  ]);

  if (catalogResult.status === "fulfilled") {
    for (const model of catalogResult.value) {
      if (modelIds.includes(model.id)) pricing.set(pricingKey(model.id), model);
    }
  }

  endpointResults.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const modelId = modelsWithPinnedProvider[index];
    for (const endpoint of result.value) {
      pricing.set(pricingKey(modelId, endpoint.provider), endpoint);
    }
  });

  return pricing;
}

function pricingForCall(call: ModelCallRecord, pricing: Map<string, ModelTokenPricing>) {
  if (!isVercelCall(call)) return undefined;
  return pricing.get(pricingKey(call.model, call.inferenceProvider));
}

function pricingKey(model: string, inferenceProvider?: string | null) {
  return `${model.toLowerCase()}::${inferenceProvider?.toLowerCase() ?? "auto"}`;
}

function providerIdForCall(call: ModelCallRecord) {
  if (call.inferenceProvider) return call.inferenceProvider;
  return isVercelCall(call) ? "auto" : call.provider ?? "legacy";
}

function isVercelCall(call: ModelCallRecord) {
  return call.provider === "vercel" || (call.provider === undefined && call.model.includes("/"));
}

function sumKnown(values: Array<number | undefined>) {
  const knownValues = values.filter((value): value is number => value !== undefined);
  return knownValues.length > 0 ? knownValues.reduce((total, value) => total + value, 0) : undefined;
}

function formatDateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatHourKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function summarizeLatency(values: number[]) {
  return {
    count: values.length,
    medianMs: median(values),
    p95Ms: percentile(values, 0.95),
  };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}