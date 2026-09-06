import "server-only";

import type { ObjectId } from "mongodb";
import type { AutomationJobDocument } from "../automation";
import { cancelAutomationJob, scheduleAutomationJob } from "../automation";
import { getCalendarSettings, hasFutureScheduledAppointment } from "../calendar";
import { listWhatsAppMessagesForAssistant } from "../whatsapp";
import { getFollowUpConfiguration } from "./config";
import { getFollowUpAttemptInstruction } from "./instructions";
import { getNextActiveWindowStart, getNextFollowUpAt, isWithinFollowUpWindow } from "./timing";

export async function scheduleNextCustomerFollowUp(input: {
  customerId: ObjectId;
  lastInboundAt: Date;
  from?: Date;
  attempt?: number;
}) {
  const [configuration, calendarSettings] = await Promise.all([
    getFollowUpConfiguration(),
    getCalendarSettings(),
  ]);
  if (!configuration.enabled || await hasFutureScheduledAppointment(input.customerId)) {
    await cancelAutomationJob("customer_follow_up", input.customerId);
    return null;
  }
  const dueAt = getNextFollowUpAt({
    from: input.from ?? new Date(),
    lastInboundAt: input.lastInboundAt,
    policy: { ...configuration, timezone: calendarSettings.timezone },
  });
  if (!dueAt) {
    await cancelAutomationJob("customer_follow_up", input.customerId);
    return null;
  }
  await scheduleAutomationJob({
    process: "customer_follow_up",
    event: {
      type: "assistant.response.sent",
      customerId: input.customerId,
      occurredAt: input.lastInboundAt,
      payload: {
        lastInboundAt: input.lastInboundAt.toISOString(),
        attempt: normalizeFollowUpAttempt(input.attempt),
      },
    },
    debounceMs: 0,
    dueAt,
  });
  return dueAt;
}

export async function getCustomerFollowUpEligibility(job: AutomationJobDocument, now = new Date()) {
  const [configuration, calendarSettings, messages, hasAppointment] = await Promise.all([
    getFollowUpConfiguration(),
    getCalendarSettings(),
    listWhatsAppMessagesForAssistant(job.customerId, undefined, 80),
    hasFutureScheduledAppointment(job.customerId, now),
  ]);
  const policy = { ...configuration, timezone: calendarSettings.timezone };
  const payloadTimestamp = typeof job.eventPayload?.lastInboundAt === "string"
    ? new Date(job.eventPayload.lastInboundAt)
    : null;
  const latestInbound = [...messages].reverse().find((message) => message.direction === "inbound");
  const attempt = normalizeFollowUpAttempt(job.eventPayload?.attempt);

  if (!configuration.enabled) return { eligible: false as const, reason: "follow_up_disabled" };
  if (!payloadTimestamp || Number.isNaN(payloadTimestamp.getTime()) || !latestInbound) {
    return { eligible: false as const, reason: "missing_inbound_reference" };
  }
  if (latestInbound.timestamp.getTime() > payloadTimestamp.getTime()) {
    return { eligible: false as const, reason: "customer_replied" };
  }
  if (hasAppointment) return { eligible: false as const, reason: "appointment_scheduled" };
  const expiresAt = new Date(payloadTimestamp.getTime() + configuration.maxHoursSinceInbound * 60 * 60_000);
  if (now >= expiresAt) return { eligible: false as const, reason: "whatsapp_window_expired" };
  if (!isWithinFollowUpWindow(now, policy)) {
    const deferUntil = getNextActiveWindowStart(now, policy);
    return deferUntil < expiresAt
      ? { eligible: false as const, reason: "quiet_hours", deferUntil }
      : { eligible: false as const, reason: "whatsapp_window_expired" };
  }
  const attemptInstruction = getFollowUpAttemptInstruction(configuration.attemptInstructions, attempt);
  return {
    eligible: true as const,
    configuration,
    latestInbound,
    attempt,
    instructions: attemptInstruction
      ? `${configuration.prompt}\n\nINSTRUÇÃO DESTA TENTATIVA (${attempt}):\n${attemptInstruction}`
      : configuration.prompt,
  };
}

export async function scheduleFollowUpQualification(customerId: ObjectId, lastInboundAt: Date) {
  await scheduleAutomationJob({
    process: "lead_qualification",
    event: {
      type: "assistant.response.sent",
      customerId,
      occurredAt: lastInboundAt,
      payload: { reason: "follow_up", lastInboundAt: lastInboundAt.toISOString() },
    },
    debounceMs: 0,
  });
}

export function getAutomationJobFollowUpAttempt(job: AutomationJobDocument) {
  return normalizeFollowUpAttempt(job.eventPayload?.attempt);
}

function normalizeFollowUpAttempt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}