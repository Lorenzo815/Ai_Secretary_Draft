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
    {
      _id: "lead-qualification-on-profile",
      name: "Qualificar cadastro suficiente",
      enabled: true,
      process: "lead_qualification",
      event: "customer.profile.updated",
      conditions: {
        all: [
          { field: "customer.profile.capturedFieldCount", operator: "gte", value: 6 },
          { field: "customer.profile.birthDate", operator: "is_present" },
          { field: "customer.profile.city", operator: "is_present" },
          { field: "customer.profile.profession", operator: "is_present" },
        ],
      },
      debounceMs: 1_000,
      cooldownMinutes: 0,
      rerunWhenSourceChanges: true,
      updatedAt: now,
      updatedBy: "system",
    },
  ];
}