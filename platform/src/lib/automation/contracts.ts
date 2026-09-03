import type { ObjectId } from "mongodb";
import type { AgentConditionGroup } from "../assistant/agent/contracts";

export type AutomationProcessKey = "customer_agent" | "lead_qualification";
export type AutomationEventType =
  | "message.received"
  | "customer.profile.updated"
  | "payment.status.changed"
  | "appointment.status.changed"
  | "manual.requested";

export interface AutomationEvent {
  type: AutomationEventType;
  customerId: ObjectId;
  occurredAt: Date;
  payload?: Record<string, unknown>;
}

export interface AutomationRuleDocument {
  _id: string;
  name: string;
  enabled: boolean;
  process: AutomationProcessKey;
  event: AutomationEventType;
  conditions: AgentConditionGroup;
  debounceMs: number;
  cooldownMinutes: number;
  rerunWhenSourceChanges: boolean;
  updatedAt: Date;
  updatedBy: string;
}

export interface AutomationJobDocument {
  _id: ObjectId;
  process: AutomationProcessKey;
  customerId: ObjectId;
  event: AutomationEventType;
  eventPayload?: Record<string, unknown>;
  status: "pending" | "processing" | "failed";
  revision: number;
  dueAt: Date;
  latestEventAt: Date;
  leaseUntil?: Date;
  consecutiveFailures: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}