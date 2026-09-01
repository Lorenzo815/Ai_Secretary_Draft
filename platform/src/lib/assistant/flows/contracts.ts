import type { ObjectId } from "mongodb";
import type { AssistantToolKey, ToolCall } from "../tools";

export interface FlowVersion {
  version: number;
  prompt: string;
  lifecycle: "single_call" | "tool_cycle";
  preToolPrompt: string;
  postToolPrompt: string;
  allowedTools: AssistantToolKey[];
  knowledgeContext: string;
  completionCriteria: string;
  allowedTransitions: string[];
  createdAt: Date;
}

export interface AssistantSettingsDocument {
  key: "global";
  defaultFlowKey: string;
  processingEnabled: boolean;
  payment: {
    pixKey: string;
    recipientName: string;
    signalAmountCents: number;
  };
  globalPrompt: string;
  offensePolicy: string;
  handoffPolicy: string;
  version: number;
  updatedAt: Date;
}

export interface FlowDefinitionDocument {
  _id: ObjectId;
  key: string;
  catalogRevision?: number;
  name: string;
  description: string;
  enabled: boolean;
  currentVersion: number;
  versions: FlowVersion[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FlowState {
  stage: string;
  collectedData: Array<{ key: string; value: string }>;
  missingData: string[];
  notes: string[];
}

export interface CustomerFlowDocument {
  _id: ObjectId;
  customerId: ObjectId;
  flowKey: string;
  flowVersion: number;
  status: "active" | "completed";
  state: FlowState;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  completionCode?: string;
  completionReason?: string;
}

export interface FlowTransitionInput {
  action: "stay" | "complete" | "transition";
  continueImmediately?: boolean;
  targetFlowKey?: string;
  reasonCode?: string;
  reason?: string;
}

export interface FlowHistoryDocument {
  _id: ObjectId;
  customerId: ObjectId;
  flowKey: string;
  flowVersion: number;
  startedAt: Date;
  completedAt: Date;
  completionCode: string;
  completionReason: string;
  finalState: FlowState;
  nextFlowKey?: string;
  source: "assistant" | "manual";
}

export interface FlowRunDocument {
  _id: ObjectId;
  customerId: ObjectId;
  jobRevision: number;
  flowKey: string;
  flowVersion: number;
  decision: string;
  deliveryStatus: "internal_transition" | "sent";
  reply: string;
  state: FlowState;
  transition: FlowTransitionInput;
  toolCalls?: ToolCall[];
  toolResult?: string;
  createdAt: Date;
}