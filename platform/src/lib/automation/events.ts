import "server-only";

import { findCustomerById, getCustomerProfileSnapshot } from "../crm";
import { matchesConditions } from "./conditions";
import type { AutomationEvent } from "./contracts";
import { scheduleAutomationJob } from "./queue";
import { listAutomationRules } from "./repository";

export async function emitAutomationEvent(event: AutomationEvent) {
  const [rules, customer] = await Promise.all([
    listAutomationRules(),
    findCustomerById(event.customerId.toString()),
  ]);
  if (!customer) return [];
  const profile = getCustomerProfileSnapshot(customer);
  const facts = {
    event: { type: event.type, ...event.payload },
    customer: {
      serviceStatus: customer.serviceStatus ?? "ai_active",
      profile: {
        capturedFieldCount: countCapturedFields(profile),
        fullName: profile.fullName,
        birthDate: profile.birthDate,
        cpf: profile.cpf,
        city: profile.address?.city,
        state: profile.address?.state,
        profession: profile.profession,
      },
    },
  };
  const matching = rules.filter((rule) => (
    rule.enabled && rule.event === event.type && matchesConditions(facts, rule.conditions)
  ));
  await Promise.all(matching.map((rule) => scheduleAutomationJob({
    process: rule.process,
    event,
    debounceMs: rule.debounceMs,
  })));
  return matching.map((rule) => rule.process);
}

function countCapturedFields(profile: ReturnType<typeof getCustomerProfileSnapshot>) {
  return [
    profile.relationshipStatus !== "unknown",
    Boolean(profile.fullName),
    Boolean(profile.birthDate),
    Boolean(profile.cpf),
    Boolean(profile.address?.postalCode),
    Boolean(profile.address?.number),
    Boolean(profile.profession),
  ].filter(Boolean).length;
}