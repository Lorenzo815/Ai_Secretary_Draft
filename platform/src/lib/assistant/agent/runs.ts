import "server-only";

import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import clientPromise from "../../mongodb";
import type { AssistantDecision } from "../tools";
import type {
  AgentAction,
  AgentConfigurationDocument,
  AgentConfigurationSnapshot,
  AgentRunDocument,
  AgentRunStepDocument,
} from "./contracts";
import type { AgentToolHistoryEntry } from "./prompt";

const DB_NAME = "ai_secretary";

export async function listCustomerAgentRuns(customerId: ObjectId, limit = 20) {
  return (await clientPromise).db(DB_NAME).collection<AgentRunDocument>("assistant_runs")
    .find({ customerId })
    .sort({ startedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .toArray();
}

export async function startAgentRun(input: {
  customerId: ObjectId;
  jobRevision: number;
  configuration: AgentConfigurationDocument;
  checkpoint?: AgentRunCheckpoint;
}) {
  const run: AgentRunDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    jobRevision: input.jobRevision,
    configRevision: input.configuration.revision,
    configHash: input.configuration.contentHash,
    configSnapshot: createConfigurationSnapshot(input.configuration),
    status: "running",
    modelIterations: input.checkpoint?.modelIterations ?? 0,
    toolExecutions: input.checkpoint?.toolExecutions ?? 0,
    mutationsExecuted: input.checkpoint?.mutationsExecuted ?? 0,
    ...(input.checkpoint?.runIds.length ? { resumedFromRunIds: input.checkpoint.runIds } : {}),
    startedAt: new Date(),
  };
  const collection = (await clientPromise).db(DB_NAME).collection<AgentRunDocument>("assistant_runs");
  await collection.insertOne(run);
  await collection.createIndex({ customerId: 1, startedAt: -1 });
  return run;
}

export async function recordAgentRunStep(input: {
  runId: ObjectId;
  customerId: ObjectId;
  iteration: number;
  action: AgentAction;
  toolResult?: AgentRunStepDocument["toolResult"];
}) {
  const step: AgentRunStepDocument = {
    _id: new ObjectId(),
    ...input,
    action: redactActionForAudit(input.action),
    createdAt: new Date(),
  };
  const collection = (await clientPromise).db(DB_NAME).collection<AgentRunStepDocument>("assistant_run_steps");
  await collection.insertOne(step);
  await collection.createIndex({ runId: 1, iteration: 1 }, { unique: true });
}

export async function finishAgentRun(input: {
  runId: ObjectId;
  status: "completed" | "failed" | "superseded";
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
  finalDecision?: AssistantDecision;
  error?: unknown;
}) {
  await (await clientPromise).db(DB_NAME).collection<AgentRunDocument>("assistant_runs").updateOne(
    { _id: input.runId },
    {
      $set: {
        status: input.status,
        modelIterations: input.modelIterations,
        toolExecutions: input.toolExecutions,
        mutationsExecuted: input.mutationsExecuted,
        finalDecision: input.finalDecision,
        error: input.error instanceof Error ? input.error.message.slice(0, 1_000) : undefined,
        completedAt: new Date(),
      },
    },
  );
}

function createConfigurationSnapshot(configuration: AgentConfigurationDocument): AgentConfigurationSnapshot {
  return {
    revision: configuration.revision,
    contentHash: configuration.contentHash,
    enabled: configuration.enabled,
    identityPrompt: configuration.identityPrompt,
    conversationPolicy: configuration.conversationPolicy,
    offensePolicy: configuration.offensePolicy,
    handoffPolicy: configuration.handoffPolicy,
    knowledge: configuration.knowledge,
    dataCollectionRules: configuration.dataCollectionRules,
    schedulingPlans: configuration.schedulingPlans,
    enabledTools: configuration.enabledTools,
    toolGuidance: configuration.toolGuidance,
    loopPolicy: configuration.loopPolicy,
    payment: {
      signalAmountCents: configuration.payment.signalAmountCents,
      configured: Boolean(configuration.payment.pixKey && configuration.payment.recipientName),
    },
  };
}

function redactActionForAudit(action: AgentAction): AgentAction {
  if (action.type !== "tool_request" || action.toolCall.tool !== "customer.update_profile") return action;
  return {
    ...action,
    toolCall: {
      ...action.toolCall,
      arguments: {
        ...action.toolCall.arguments,
        cpf: action.toolCall.arguments.cpf ? "[REDACTED]" : action.toolCall.arguments.cpf,
      },
    },
  };
}

export interface AgentRunCheckpoint {
  runIds: ObjectId[];
  toolHistory: AgentToolHistoryEntry[];
  toolResultsByFingerprint: Map<string, AgentToolHistoryEntry>;
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
}

export async function loadAgentRunCheckpoint(input: {
  customerId: ObjectId;
  jobRevision: number;
  configHash: string;
}): Promise<AgentRunCheckpoint> {
  const database = (await clientPromise).db(DB_NAME);
  const runs = await database.collection<AgentRunDocument>("assistant_runs")
    .find({
      customerId: input.customerId,
      jobRevision: input.jobRevision,
      configHash: input.configHash,
      status: { $in: ["failed", "running"] },
    })
    .sort({ startedAt: 1 })
    .toArray();
  if (runs.length === 0) return emptyCheckpoint();
  const steps = await database.collection<AgentRunStepDocument>("assistant_run_steps")
    .find({ runId: { $in: runs.map((run) => run._id) }, "action.type": "tool_request" })
    .sort({ createdAt: 1 })
    .toArray();
  return buildAgentRunCheckpoint(runs, steps);
}

export function buildAgentRunCheckpoint(
  runs: AgentRunDocument[],
  steps: AgentRunStepDocument[],
): AgentRunCheckpoint {
  const recovered = new Map<string, AgentToolHistoryEntry>();
  for (const step of steps) {
    if (
      step.action.type !== "tool_request"
      || !step.toolResult?.resultId
      || !isSuccessfulPersistedToolResult(step.action.toolCall.tool, step.toolResult.result)
    ) continue;
    const fingerprint = step.toolResult.fingerprint ?? fingerprintAgentToolRequest(step.action);
    recovered.set(fingerprint, {
      resultId: step.toolResult.resultId,
      request: step.action,
      result: step.toolResult.result,
    });
  }
  const toolHistory = [...recovered.values()];
  const recordedMutations = steps.filter((step) => step.toolResult?.mutation).length;
  return {
    runIds: runs.map((run) => run._id),
    toolHistory,
    toolResultsByFingerprint: recovered,
    modelIterations: Math.max(...runs.map((run) => run.modelIterations), 0),
    toolExecutions: Math.max(...runs.map((run) => run.toolExecutions), 0),
    mutationsExecuted: Math.max(recordedMutations, ...runs.map((run) => run.mutationsExecuted), 0),
  };
}

function isSuccessfulPersistedToolResult(tool: string, value: unknown) {
  if (!value || typeof value !== "object") return false;
  const envelope = value as { executedTools?: unknown; results?: unknown };
  if (!Array.isArray(envelope.executedTools) || !Array.isArray(envelope.results)) return false;
  const executedTools = envelope.executedTools;
  const results = envelope.results;
  return executedTools.some((executedTool, index) => {
    const result = results[index];
    return executedTool === tool
      && Boolean(result && typeof result === "object" && (result as { ok?: unknown }).ok === true);
  });
}

export function fingerprintAgentToolRequest(request: Extract<AgentAction, { type: "tool_request" }>) {
  const redactedRequest = redactActionForAudit(request) as Extract<AgentAction, { type: "tool_request" }>;
  return createHash("sha256").update(stableStringify(redactedRequest.toolCall)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function emptyCheckpoint(): AgentRunCheckpoint {
  return {
    runIds: [],
    toolHistory: [],
    toolResultsByFingerprint: new Map(),
    modelIterations: 0,
    toolExecutions: 0,
    mutationsExecuted: 0,
  };
}