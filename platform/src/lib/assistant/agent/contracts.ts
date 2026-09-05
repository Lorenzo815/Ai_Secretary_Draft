import type { ObjectId } from "mongodb";
import type { AssistantDecision, AssistantToolKey, ToolCall } from "../tools";

export type AgentConditionOperator = "eq" | "neq" | "is_present" | "is_absent" | "gte" | "lte";

export interface AgentCondition {
  field: string;
  operator: AgentConditionOperator;
  value?: string | number | boolean;
}

export interface AgentConditionGroup {
  all?: AgentCondition[];
  any?: AgentCondition[];
}

export interface DataCollectionRule {
  fieldKey: string;
  label: string;
  purpose: string;
  required: boolean;
  collectionOrder: number;
  sensitive: boolean;
}

export interface SchedulingPlanStep {
  key: string;
  eventTypeKey: string;
  label: string;
  required: boolean;
}

export type SchedulingConstraint =
  | { type: "ordered"; before: string; after: string }
  | { type: "gap"; from: string; to: string; minMinutes: number; maxMinutes: number }
  | { type: "same_day"; steps: string[] };

export interface SchedulingPlan {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: SchedulingPlanStep[];
  constraints: SchedulingConstraint[];
  prerequisites: AgentConditionGroup;
  proposalExpiryMinutes: number;
}

export interface AgentLoopPolicy {
  maxModelIterations: number;
  maxToolExecutions: number;
  maxMutations: number;
  maxRepeatedInvalidCalls: number;
}

export interface AgentConfigurationDocument {
  _id: "active";
  revision: number;
  contentHash: string;
  enabled: boolean;
  identityPrompt: string;
  conversationPolicy: string;
  offensePolicy: string;
  handoffPolicy: string;
  knowledge: string;
  dataCollectionRules: DataCollectionRule[];
  schedulingPlans: SchedulingPlan[];
  enabledTools: AssistantToolKey[];
  toolGuidance: Partial<Record<AssistantToolKey, string>>;
  loopPolicy: AgentLoopPolicy;
  payment: {
    pixKey: string;
    recipientName: string;
    signalAmountCents: number;
  };
  updatedAt: Date;
  updatedBy: string;
}

export interface AgentRuntimeContext {
  time: {
    nowUtc: string;
    clinicLocalNow: string;
    clinicTimezone: string;
    customerTimezone: string | null;
  };
  customer: Record<string, unknown>;
  operations: {
    serviceStatus: string;
    paymentStatus: string | null;
    activeSchedulingOption: unknown | null;
  };
  clinic: {
    eventTypes: Array<{
      key: string;
      name: string;
      durationMinutes: number;
      resourceId: string;
    }>;
    schedulingPlans: SchedulingPlan[];
  };
  execution: {
    iteration: number;
    remainingModelIterations: number;
    remainingToolExecutions: number;
    mutationsExecuted: number;
  };
}

export interface AgentMemory {
  summary: string;
  pendingQuestion: string | null;
  nonSensitiveFacts: string[];
}

export interface AgentToolRequest {
  type: "tool_request";
  reasonCode: "need_authoritative_data" | "persist_customer_data" | "perform_confirmed_action";
  toolCall: ToolCall;
}

export interface AgentFinalResponse {
  type: "final";
  decision: AssistantDecision;
  message: string;
  groundingResultIds: string[];
  memory: AgentMemory;
}

export type AgentAction = AgentToolRequest | AgentFinalResponse;

export type AgentConfigurationSnapshot = Omit<
  AgentConfigurationDocument,
  "_id" | "updatedAt" | "updatedBy" | "payment"
> & {
  payment: {
    signalAmountCents: number;
    configured: boolean;
  };
};

export interface AgentRunDocument {
  _id: ObjectId;
  customerId: ObjectId;
  jobRevision: number;
  configRevision: number;
  configHash: string;
  configSnapshot: AgentConfigurationSnapshot;
  status: "running" | "completed" | "failed" | "superseded";
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
  finalDecision?: AssistantDecision;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface AgentRunStepDocument {
  _id: ObjectId;
  runId: ObjectId;
  customerId: ObjectId;
  iteration: number;
  action: AgentAction;
  toolResult?: unknown;
  createdAt: Date;
}