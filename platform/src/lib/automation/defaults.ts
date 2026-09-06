import type { AutomationRuleDocument } from "./contracts";

export function createDefaultAutomationRules(): AutomationRuleDocument[] {
  const now = new Date();
  return [
    {
      _id: "customer-agent-on-message",
      name: "Responder novas mensagens",
      enabled: true,
      process: "customer_agent",
      event: "message.received",
      conditions: { all: [{ field: "customer.serviceStatus", operator: "eq", value: "ai_active" }] },
      debounceMs: 8_000,
      cooldownMinutes: 0,
      rerunWhenSourceChanges: true,
      updatedAt: now,
      updatedBy: "system",
    },
  ];
}