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
  trigger: "inbound_message" | "follow_up";
  followUpInstructions?: string;
  followUpAttempt?: number;
  iteration: number;
}): Promise<AgentRuntimeContext> {
  const [calendarSettings, payment, activeSchedulingOption] = await Promise.all([
    getCalendarSettings(),
    getLatestPaymentRequest(input.customer._id),
    getActiveSchedulingPlanOption(input.customer._id),
  ]);
  const profile = getCustomerProfileSnapshot(input.customer);
  const configuredMissingFields = getConfiguredMissingFields(profile, input.configuration.dataCollectionRules);
  const bookableEventTypes = new Set(input.configuration.bookableEventTypeKeys);
  const bookablePlans = input.configuration.schedulingPlans.filter((plan) => (
    plan.enabled && plan.steps.every((step) => bookableEventTypes.has(step.eventTypeKey))
  ));
  const activeOptionPlanKey = activeSchedulingOption && typeof activeSchedulingOption === "object"
    ? (activeSchedulingOption as { planKey?: unknown }).planKey
    : null;
  const visibleSchedulingOption = typeof activeOptionPlanKey === "string" && (
    bookablePlans.some((plan) => plan.key === activeOptionPlanKey) ||
    (activeOptionPlanKey.startsWith("event:") && bookableEventTypes.has(activeOptionPlanKey.slice(6)))
  )
    ? activeSchedulingOption
    : null;
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
      activeSchedulingOption: visibleSchedulingOption,
    },
    clinic: {
      eventTypes: calendarSettings.eventTypes.filter((eventType) => bookableEventTypes.has(eventType.key)).map((eventType) => {
        const resource = calendarSettings.resources.find((item) => item.id === eventType.resourceId);
        return {
          key: eventType.key,
          name: eventType.name,
          durationMinutes: eventType.durationMinutes,
          resourceId: eventType.resourceId,
          resourceName: resource?.name ?? "Recurso não identificado",
        };
      }),
      resources: calendarSettings.resources.map((resource) => ({
        id: resource.id,
        name: resource.name,
      })),
      schedulingPlans: bookablePlans,
    },
    execution: {
      trigger: input.trigger,
      iteration: input.iteration,
      remainingModelIterations: input.configuration.loopPolicy.maxModelIterations - input.iteration,
    },
    followUp: input.trigger === "follow_up" ? {
      attempt: input.followUpAttempt ?? 1,
      instructions: input.followUpInstructions ?? "",
      analysis: input.customer.leadQualification?.version === 5 ? {
        explicitSignals: input.customer.leadQualification.explicitSignals,
        dropOffAnalysis: input.customer.leadQualification.dropOffAnalysis,
        frictions: input.customer.leadQualification.frictions,
        openQuestions: input.customer.leadQualification.openQuestions,
        recommendedApproach: input.customer.leadQualification.recommendedApproach,
      } : null,
    } : null,
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