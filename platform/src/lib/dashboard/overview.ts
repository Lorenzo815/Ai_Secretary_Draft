import "server-only";

import type { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { LEAD_QUALIFICATION_VERSION, type LeadInsightTagTone } from "../qualification/contracts";

const DB_NAME = "ai_secretary";

interface CohortCustomerDocument {
  _id: ObjectId;
  name: string;
  relationship?: { status?: string };
  profile?: Record<string, unknown>;
  leadQualification?: {
    version?: number;
    generatedAt?: Date;
    profileFit?: { score?: number };
    combinedFit?: { score?: number };
    insightTags?: Array<{ label: string; tone: LeadInsightTagTone }>;
  };
  createdAt: Date;
}

interface PaymentAnalyticsDocument {
  customerId?: ObjectId;
  status: string;
  amountCents: number;
  createdAt: Date;
}

interface AppointmentAnalyticsDocument {
  customerId?: ObjectId;
  eventType: string;
  status: string;
  source: string;
  createdAt: Date;
}

interface MessageAnalyticsDocument {
  customerId?: ObjectId;
  direction: string;
  timestamp: Date;
  body: string;
}

export async function getDashboardOverview(periodDays = 30) {
  const client = await clientPromise;
  const database = client.db(DB_NAME);
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1_000);

  const [
    messageDirections,
    messageStatusCounts,
    jobStatuses,
    upcomingAppointments,
    cohortCustomers,
    recentPayments,
    recentAppointments,
    agentRunStatusCounts,
    responseMessages,
    pendingPayments,
    aiCallStatusCounts,
    aiCallTaskCounts,
  ] = await Promise.all([
    database.collection("whatsapp_messages").aggregate<{ _id: string; count: number }>([
      { $match: { timestamp: { $gte: last24Hours } } },
      { $group: { _id: "$direction", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("whatsapp_messages").aggregate<{ _id: string; count: number }>([
      { $match: { timestamp: { $gte: last24Hours } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("automation_jobs").aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("calendar_appointments").find(
      { status: "scheduled", startAt: { $gte: now } },
      { projection: { _id: 0, customerName: 1, eventType: 1, startAt: 1, endAt: 1, timezone: 1 } },
    ).sort({ startAt: 1 }).limit(6).toArray(),
    database.collection<CohortCustomerDocument>("crm_customers").find(
      { createdAt: { $gte: periodStart } },
      { projection: { _id: 1, name: 1, relationship: 1, profile: 1, leadQualification: 1 } },
    ).toArray(),
    database.collection<PaymentAnalyticsDocument>("payment_requests").find(
      { createdAt: { $gte: periodStart } },
      { projection: { _id: 0, customerId: 1, status: 1, amountCents: 1, createdAt: 1 } },
    ).toArray(),
    database.collection<AppointmentAnalyticsDocument>("calendar_appointments").find(
      { createdAt: { $gte: periodStart } },
      { projection: { _id: 0, customerId: 1, eventType: 1, status: 1, source: 1 } },
    ).toArray(),
    database.collection("assistant_runs").aggregate<{ _id: string; count: number }>([
      { $match: { startedAt: { $gte: periodStart } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    database.collection<MessageAnalyticsDocument>("whatsapp_messages").find(
      { timestamp: { $gte: periodStart }, direction: { $in: ["inbound", "outbound"] } },
      { projection: { _id: 0, customerId: 1, direction: 1, timestamp: 1, body: 1 } },
    ).sort({ timestamp: 1 }).toArray(),
    database.collection<PaymentAnalyticsDocument>("payment_requests").find(
      { status: "awaiting_human_confirmation" },
      { projection: { _id: 0, customerId: 1, amountCents: 1, createdAt: 1 } },
    ).sort({ createdAt: 1 }).limit(20).toArray(),
    database.collection("ai_task_calls").aggregate<{ _id: string; count: number }>([
      { $match: { startedAt: { $gte: periodStart } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("ai_task_calls").aggregate<{ _id: string; count: number }>([
      { $match: { startedAt: { $gte: periodStart } } },
      { $group: { _id: "$taskKey", count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const newPatientIds = new Set(cohortCustomers
    .filter((customer) => customer.relationship?.status === "new")
    .map((customer) => customer._id.toString()));
  const profileCompleteIds = new Set(cohortCustomers
    .filter((customer) => customer.relationship?.status === "new" && isProfileComplete(customer.profile))
    .map((customer) => customer._id.toString()));
  const paymentRequestedIds = distinctCustomerIds(recentPayments, newPatientIds);
  const paymentConfirmedIds = distinctCustomerIds(
    recentPayments.filter((payment) => payment.status === "paid"),
    paymentRequestedIds,
  );
  const scheduledIds = distinctCustomerIds(
    recentAppointments.filter((appointment) => (
      appointment.eventType === "doctor_consultation"
      && appointment.status !== "cancelled"
    )),
    newPatientIds,
  );
  const activeConversationIds = new Set(responseMessages.flatMap((message) => {
    const customerId = message.customerId?.toString();
    return customerId && message.timestamp >= last24Hours ? [customerId] : [];
  }));
  const responseDurations = calculateResponseDurations(responseMessages);
  const paymentStatusCounts = countBy(recentPayments, (payment) => payment.status as string);
  const appointmentSourceCounts = countBy(recentAppointments, (appointment) => appointment.source as string);
  const messagesByDirection = Object.fromEntries(messageDirections.map((item) => [item._id, item.count]));
  const messagesByStatus = Object.fromEntries(messageStatusCounts.map((item) => [item._id, item.count]));
  const aiCallStatuses = Object.fromEntries(aiCallStatusCounts.map((item) => [item._id, item.count]));
  const aiCallsByTask = Object.fromEntries(aiCallTaskCounts.map((item) => [item._id, item.count]));
  const agentRunStatuses = Object.fromEntries(agentRunStatusCounts.map((item) => [item._id, item.count]));
  const finishedAgentRuns = Number(agentRunStatuses.completed ?? 0) + Number(agentRunStatuses.failed ?? 0);
  const currentQualifications = cohortCustomers.flatMap((customer) => {
    const qualification = customer.leadQualification;
    return qualification?.version === LEAD_QUALIFICATION_VERSION
      && qualification.generatedAt instanceof Date
      && Number.isFinite(qualification.profileFit?.score)
      && Number.isFinite(qualification.combinedFit?.score)
      ? [{
        profileFit: { score: qualification.profileFit!.score! },
        combinedFit: { score: qualification.combinedFit!.score! },
      }]
      : [];
  });

  return {
    generatedAt: now,
    upcomingAppointments,
    periodDays,
    messageSummary: {
      activeConversations: activeConversationIds.size,
      inbound: Number(messagesByDirection.inbound ?? 0),
      outbound: Number(messagesByDirection.outbound ?? 0),
      deliveredOrRead: Number(messagesByStatus.delivered ?? 0) + Number(messagesByStatus.read ?? 0),
      failed: Number(messagesByStatus.failed ?? 0),
    },
    topInsightTags: summarizeInsightTags(cohortCustomers),
    commercialMetrics: {
      newPatients: newPatientIds.size,
      returningPatients: cohortCustomers.filter((customer) => customer.relationship?.status === "returning").length,
      profileCompleted: profileCompleteIds.size,
      paymentRequested: paymentRequestedIds.size,
      paymentConfirmed: paymentConfirmedIds.size,
      scheduledPatients: scheduledIds.size,
      profileCompletionRate: percentage(profileCompleteIds.size, newPatientIds.size),
      paymentConfirmationRate: percentage(paymentConfirmedIds.size, paymentRequestedIds.size),
      schedulingRate: percentage(scheduledIds.size, newPatientIds.size),
      medianResponseMinutes: median(responseDurations) / 60_000,
      qualifiedLeads: currentQualifications.length,
      averageProfileFit: Math.round(average(currentQualifications.map((item) => item.profileFit.score))),
      averageCombinedFit: Math.round(average(currentQualifications.map((item) => item.combinedFit.score))),
    },
    paymentSummary: {
      pendingCount: Number(paymentStatusCounts.awaiting_human_confirmation ?? 0),
      paidCount: Number(paymentStatusCounts.paid ?? 0),
      rejectedCount: Number(paymentStatusCounts.rejected ?? 0),
      paidAmountCents: recentPayments
        .filter((payment) => payment.status === "paid")
        .reduce((total, payment) => total + Number(payment.amountCents ?? 0), 0),
    },
    appointmentSources: {
      assistant: Number(appointmentSourceCounts.assistant ?? 0),
      manual: Number(appointmentSourceCounts.manual ?? 0),
    },
    aiSummary: {
      totalCalls: aiCallStatusCounts.reduce((total, item) => total + item.count, 0),
      failedCalls: Number(aiCallStatuses.failed ?? 0),
      agentCalls: Number(aiCallsByTask.customer_agent ?? 0),
      qualificationCalls: Number(aiCallsByTask.lead_qualification ?? 0),
      completedRuns: Number(agentRunStatuses.completed ?? 0),
      finishedRuns: finishedAgentRuns,
      runSuccessRate: finishedAgentRuns > 0
        ? percentage(Number(agentRunStatuses.completed ?? 0), finishedAgentRuns)
        : null,
      pendingJobs: Number(Object.fromEntries(jobStatuses.map((item) => [item._id, item.count])).pending ?? 0),
      failedJobs: Number(Object.fromEntries(jobStatuses.map((item) => [item._id, item.count])).failed ?? 0),
    },
    pendingPayments: pendingPayments.map((payment) => ({
      customerId: payment.customerId as ObjectId,
      amountCents: Number(payment.amountCents ?? 0),
      createdAt: payment.createdAt as Date,
    })),
  };
}

function isProfileComplete(profile: Record<string, unknown> | undefined) {
  if (!profile) return false;
  const address = profile.address as { number?: unknown } | undefined;
  return Boolean(profile.fullName && profile.birthDate && profile.cpf && address?.number && profile.profession);
}

function distinctCustomerIds(
  documents: Array<{ customerId?: unknown }>,
  allowedIds: Set<string>,
) {
  return new Set(documents.flatMap((document) => {
    const id = document.customerId?.toString();
    return id && allowedIds.has(id) ? [id] : [];
  }));
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizeInsightTags(customers: CohortCustomerDocument[]) {
  const tags = new Map<string, { label: string; tone: LeadInsightTagTone; count: number }>();
  for (const customer of customers) {
    if (customer.leadQualification?.version !== LEAD_QUALIFICATION_VERSION) continue;
    const customerTags = new Set<string>();
    for (const tag of customer.leadQualification.insightTags ?? []) {
      const label = tag.label.trim();
      if (!label) continue;
      const key = label.toLocaleLowerCase("pt-BR");
      if (customerTags.has(key)) continue;
      customerTags.add(key);
      const current = tags.get(key);
      tags.set(key, current
        ? { ...current, count: current.count + 1 }
        : { label, tone: tag.tone, count: 1 });
    }
  }
  return [...tags.values()]
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label, "pt-BR"))
    .slice(0, 6);
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function calculateResponseDurations(messages: Array<{
  customerId?: unknown;
  direction?: unknown;
  timestamp?: unknown;
}>) {
  const pendingInbound = new Map<string, number>();
  const durations: number[] = [];
  for (const message of messages) {
    const customerId = message.customerId?.toString();
    const timestamp = message.timestamp instanceof Date ? message.timestamp.getTime() : NaN;
    if (!customerId || !Number.isFinite(timestamp)) continue;
    if (message.direction === "inbound" && !pendingInbound.has(customerId)) {
      pendingInbound.set(customerId, timestamp);
    }
    if (message.direction === "outbound" && pendingInbound.has(customerId)) {
      durations.push(timestamp - pendingInbound.get(customerId)!);
      pendingInbound.delete(customerId);
    }
  }
  return durations.filter((duration) => duration >= 0 && duration <= 24 * 60 * 60 * 1_000);
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}
