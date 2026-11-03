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

/**
 * Deposit rule of a scheduling plan. One deposit covers every event of the booking.
 * - always: every booking of the plan needs a paid deposit before it is confirmed;
 * - first_time: only when the patient never had a paid deposit at this clinic (any plan);
 * - none: no deposit; the plan is booked directly.
 */
export type PlanPaymentRequirement = "always" | "first_time" | "none";
export interface SchedulingPlanPayment {
  requirement: PlanPaymentRequirement;
  amountCents: number;
}

export interface SchedulingPlan {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: SchedulingPlanStep[];
  constraints: SchedulingConstraint[];
  prerequisites: AgentConditionGroup;
  /** Missing on plans saved before deposits were per plan; see resolvePlanPayment. */
  payment?: SchedulingPlanPayment;
  proposalExpiryMinutes: number;
  holdDurationMinutes: number;
}

export interface AgentLoopPolicy {
  maxModelIterations: number;
  maxRepeatedInvalidCalls: number;
}

export type RelationshipRoutingAction = "preserve" | "ai_active" | "waiting_human";
export type RelationshipRoutingPolicy = Record<"new" | "returning", RelationshipRoutingAction>;

export interface AgentConfigurationDocument {
  _id: string;
  revision: number;
  contentHash: string;
  enabled: boolean;
  identityPrompt: string;
  conversationPolicy: string;
  responseStyle: string;
  offensePolicy: string;
  handoffPolicy: string;
  relationshipRouting: RelationshipRoutingPolicy;
  journeyPolicy: string;
  knowledge: string;
  dataCollectionRules: DataCollectionRule[];
  schedulingPlans: SchedulingPlan[];
  bookableEventTypeKeys: string[];
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
    paymentProvider: "manual" | "mercado_pago";
    paymentMethods: Array<"pix" | "payment_link">;
    paymentLinkMethods: string[];
    maxInstallments: number;
    /** A deposit paid earlier that confirmed no booking (its hold expired); calendar.book applies it. */
    unallocatedPaidDeposit: { amountCents: number } | null;
    activeSchedulingOption: unknown | null;
  };
  clinic: {
    eventTypes: Array<{
      key: string;
      name: string;
      durationMinutes: number;
      resourceId: string;
      resourceName: string;
    }>;
    resources: Array<{
      id: string;
      name: string;
    }>;
    schedulingPlans: Array<SchedulingPlan & {
      /** The plan's deposit rule and whether a new booking by this patient needs a deposit now. */
      deposit: SchedulingPlanPayment & { requiredNow: boolean };
    }>;
  };
  execution: {
    trigger: "inbound_message" | "follow_up";
    iteration: number;
    remainingModelIterations: number;
  };
  followUp: {
    attempt: number;
    instructions: string;
    analysis: {
      explicitSignals: CustomerFollowUpSignals;
      dropOffAnalysis: {
        likelyCause: string | null;
        confidence: "high" | "medium" | "low";
        evidence: string[];
        recommendedResponse: string;
      };
      frictions: string[];
      openQuestions: string[];
      recommendedApproach: string;
    } | null;
  } | null;
}

interface CustomerFollowUpSignals {
  schedulingIntent: "strong" | "moderate" | "weak" | "unknown";
  priceSentiment: "positive" | "neutral" | "concerned" | "negative" | "unknown";
  engagement: "high" | "medium" | "low";
  evidence: Array<{ signal: string; observation: string }>;
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

/** One immutable, credential-free copy per configuration version, shared by all runs that used it. */
export interface AgentConfigurationSnapshotDocument {
  _id: string;
  companyId: ObjectId;
  configHash: string;
  configRevision: number;
  snapshot: AgentConfigurationSnapshot;
  createdAt: Date;
}

export interface AgentRunDocument {
  _id: ObjectId;
  jobId: ObjectId;
  customerId: ObjectId;
  jobRevision: number;
  configRevision: number;
  configHash: string;
  /** Legacy runs only; new runs reference `assistant_config_snapshots` by `configHash`. */
  configSnapshot?: AgentConfigurationSnapshot;
  status: "running" | "completed" | "failed" | "superseded";
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
  resumedFromRunIds?: ObjectId[];
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
  toolResult?: {
    resultId: string;
    result: unknown;
    fingerprint?: string;
    mutation?: boolean;
    retryable?: boolean;
  };
  createdAt: Date;
}