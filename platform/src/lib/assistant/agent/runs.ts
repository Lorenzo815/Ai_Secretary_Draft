import "server-only";

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
}) {
  const run: AgentRunDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    jobRevision: input.jobRevision,
    configRevision: input.configuration.revision,
    configHash: input.configuration.contentHash,
    configSnapshot: createConfigurationSnapshot(input.configuration),
    status: "running",
    modelIterations: 0,
    toolExecutions: 0,
    mutationsExecuted: 0,
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
  toolResult?: unknown;
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