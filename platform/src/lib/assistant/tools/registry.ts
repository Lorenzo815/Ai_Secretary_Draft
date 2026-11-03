import "server-only";

import { calendarToolDefinitions } from "./calendar-definitions";
import { APPOINTMENT_CONFIRMATION_TOOL, confirmationToolDefinitions } from "./confirmation-definitions";
import { customerToolDefinitions } from "./customer-definitions";
import { paymentToolDefinitions } from "./payment-definitions";
import type { ToolDefinition, ToolMetadata } from "./contracts";

export const toolRegistry = {
  ...customerToolDefinitions,
  ...paymentToolDefinitions,
  ...calendarToolDefinitions,
  ...confirmationToolDefinitions,
} satisfies Record<string, ToolDefinition>;

export type AssistantToolKey = keyof typeof toolRegistry;

export function isAssistantToolKey(value: string): value is AssistantToolKey {
  return Object.hasOwn(toolRegistry, value);
}

export function getToolDefinition(key: AssistantToolKey) {
  return toolRegistry[key];
}

/** Tools clinics can switch on in Agent Studio. The confirmation tool is enabled per run, by the confirmation task. */
export function listToolMetadata(): ToolMetadata[] {
  return Object.entries(toolRegistry).filter(([key]) => key !== APPOINTMENT_CONFIRMATION_TOOL).map(([key, definition]) => ({
    key,
    label: definition.label,
    description: definition.description,
    mutates: definition.mutates,
    protectedInstructions: definition.promptInstructions,
  }));
}