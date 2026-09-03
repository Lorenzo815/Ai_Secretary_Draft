import type { ObjectId } from "mongodb";
import type { AgentConfigurationDocument } from "../agent/contracts";

export type JsonSchema = Record<string, unknown>;

export const ASSISTANT_DECISIONS = ["reply", "out_of_scope", "emergency", "human_handoff"] as const;
export type AssistantDecision = (typeof ASSISTANT_DECISIONS)[number];

export interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionContext {
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  activeSchedulingOptionId?: string;
  configuration: AgentConfigurationDocument;
}

export interface ToolExecution {
  output: string;
  retryable: boolean;
}

export interface ToolDefinition {
  label: string;
  description: string;
  mutates: boolean;
  argumentsSchema: JsonSchema;
  promptInstructions: string;
  execute: (context: ToolExecutionContext, args: Record<string, unknown>) => Promise<ToolExecution | null>;
  getGroundedReply?: (output: string) => string | null;
}

export interface ToolMetadata {
  key: string;
  label: string;
  description: string;
  mutates: boolean;
}