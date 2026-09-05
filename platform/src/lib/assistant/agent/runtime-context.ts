import "server-only";

import { DateTime } from "luxon";
import type { CustomerProfileSnapshot } from "../../crm";
import { getActiveSchedulingPlanOption, getCalendarSettings } from "../../calendar";
import { getLatestPaymentRequest } from "../../payments";
import type { CustomerDocument } from "../../crm";
import { getCustomerProfileSnapshot } from "../../crm";
import type { AgentConfigurationDocument, AgentRuntimeContext, DataCollectionRule } from "./contracts";

export async function buildAgentRuntimeContext(input: {
  customer: CustomerDocument;
  configuration: AgentConfigurationDocument;
  iteration: number;
  toolExecutions: number;
  mutationsExecuted: number;
}): Promise<AgentRuntimeContext> {
  const [calendarSettings, payment, activeSchedulingOption] = await Promise.all([
    getCalendarSettings(),
    getLatestPaymentRequest(input.customer._id),
    getActiveSchedulingPlanOption(input.customer._id),
  ]);
  const profile = getCustomerProfileSnapshot(input.customer);
  const configuredMissingFields = getConfiguredMissingFields(profile, input.configuration.dataCollectionRules);
  return {
    time: {
      nowUtc: new Date().toISOString(),
      clinicLocalNow: DateTime.now().setZone(calendarSettings.timezone).toISO()!,
      clinicTimezone: calendarSettings.timezone,
      customerTimezone: null,
    },
    customer: {
      ...profile,
      configuredMissingFields,
      missingFieldsCount: configuredMissingFields.length,
    },
    operations: {
      serviceStatus: input.customer.serviceStatus ?? "ai_active",
      paymentStatus: payment?.status ?? null,
      activeSchedulingOption,
    },
    clinic: {
      eventTypes: calendarSettings.eventTypes.map((eventType) => ({
        key: eventType.key,
        name: eventType.name,
        durationMinutes: eventType.durationMinutes,
        resourceId: eventType.resourceId,
      })),
      schedulingPlans: input.configuration.schedulingPlans.filter((plan) => plan.enabled),
    },
    execution: {
      iteration: input.iteration,
      remainingModelIterations: input.configuration.loopPolicy.maxModelIterations - input.iteration,
      remainingToolExecutions: input.configuration.loopPolicy.maxToolExecutions - input.toolExecutions,
      mutationsExecuted: input.mutationsExecuted,
    },
  };
}

export function getConfiguredMissingFields(
  profile: CustomerProfileSnapshot,
  rules: DataCollectionRule[],
) {
  const missingFromProfile = new Set(profile.missingFields);
  return rules
    .filter((rule) => rule.required && missingFromProfile.has(rule.fieldKey))
    .sort((first, second) => first.collectionOrder - second.collectionOrder)
    .map((rule) => rule.fieldKey);
}