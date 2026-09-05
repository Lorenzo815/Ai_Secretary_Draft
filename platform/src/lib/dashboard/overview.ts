import "server-only";

import type { ObjectId } from "mongodb";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";

interface CohortCustomerDocument {
  _id: ObjectId;
  relationship?: { status?: string };
  profile?: Record<string, unknown>;
  leadQualification?: {
    version?: number;
    generatedAt?: Date;
    profileFit?: { score?: number };
    combinedFit?: { score?: number };
  };
  createdAt: Date;
}

interface QualificationAnalyticsDocument {
  customerId: ObjectId;
  version: number;
  generatedAt: Date;
  profileFit: { score: number };
  combinedFit: { score: number };
}

type QualificationScoreDocument = Pick<
  QualificationAnalyticsDocument,
  "customerId" | "generatedAt" | "profileFit" | "combinedFit"
>;

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

export async function getDashboardOverview() {
  const client = await clientPromise;
  const database = client.db(DB_NAME);
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const last14Days = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1_000);
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const nextSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const calendarSettings = await database.collection<{ _id: string; timezone?: string }>("calendar_settings").findOne(
    { _id: "default-calendar" },
    { projection: { timezone: 1 } },
  );
  const timezone = typeof calendarSettings?.timezone === "string"
    ? calendarSettings.timezone
    : "America/Sao_Paulo";

  const [
    customerStatuses,
    messageDirections,
    messageFailures,
    jobStatuses,
    upcomingAppointments,
    appointmentsNextSevenDays,
    agentRunsLast24Hours,
    cohortCustomers,
    recentPayments,
    recentAppointments,
    agentRunStatusCounts,
    dailyMessageCounts,
    responseMessages,
    pendingPayments,
    qualificationHistory,
  ] = await Promise.all([
    database.collection("crm_customers").aggregate<{ _id: string; count: number }>([
      { $group: { _id: { $ifNull: ["$serviceStatus", "ai_active"] }, count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("whatsapp_messages").aggregate<{ _id: string; count: number }>([
      { $match: { timestamp: { $gte: last24Hours } } },
      { $group: { _id: "$direction", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("whatsapp_messages").countDocuments({ status: "failed", timestamp: { $gte: last24Hours } }),
    database.collection("automation_jobs").aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    database.collection("calendar_appointments").find(
      { status: "scheduled", startAt: { $gte: now } },
      { projection: { _id: 0, customerName: 1, eventType: 1, startAt: 1, endAt: 1, timezone: 1 } },
    ).sort({ startAt: 1 }).limit(6).toArray(),
    database.collection("calendar_appointments").countDocuments({ status: "scheduled", startAt: { $gte: now, $lt: nextSevenDays } }),
    database.collection("assistant_runs").countDocuments({ startedAt: { $gte: last24Hours }, status: "completed" }),
    database.collection<CohortCustomerDocument>("crm_customers").find(
      { createdAt: { $gte: last30Days } },
      { projection: { _id: 1, relationship: 1, profile: 1, leadQualification: 1 } },
    ).toArray(),
    database.collection<PaymentAnalyticsDocument>("payment_requests").find(
      { createdAt: { $gte: last30Days } },
      { projection: { _id: 0, customerId: 1, status: 1, amountCents: 1, createdAt: 1 } },
    ).toArray(),
    database.collection<AppointmentAnalyticsDocument>("calendar_appointments").find(
      { createdAt: { $gte: last30Days } },
      { projection: { _id: 0, customerId: 1, eventType: 1, status: 1, source: 1 } },
    ).toArray(),
    database.collection("assistant_runs").aggregate<{ _id: string; count: number }>([
      { $match: { startedAt: { $gte: last30Days } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    database.collection("whatsapp_messages").aggregate<{ _id: { date: string; direction: string }; count: number }>([
      { $match: { timestamp: { $gte: last14Days }, direction: { $in: ["inbound", "outbound"] } } },
      { $group: {
        _id: {
          date: { $dateToString: { date: "$timestamp", format: "%Y-%m-%d", timezone } },
          direction: "$direction",
        },
        count: { $sum: 1 },
      } },
    ]).toArray(),
    database.collection<MessageAnalyticsDocument>("whatsapp_messages").find(
      { timestamp: { $gte: last30Days }, direction: { $in: ["inbound", "outbound"] } },
      { projection: { _id: 0, customerId: 1, direction: 1, timestamp: 1, body: 1 } },
    ).sort({ timestamp: 1 }).toArray(),
    database.collection<PaymentAnalyticsDocument>("payment_requests").find(
      { status: "awaiting_human_confirmation" },
      { projection: { _id: 0, customerId: 1, amountCents: 1, createdAt: 1 } },
    ).sort({ createdAt: 1 }).limit(20).toArray(),
    database.collection<QualificationAnalyticsDocument>("lead_qualification_history").find(
      { version: 2, generatedAt: { $gte: last30Days } },
      { projection: { _id: 0, customerId: 1, version: 1, generatedAt: 1, profileFit: 1, combinedFit: 1 } },
    ).sort({ generatedAt: 1 }).toArray(),
  ]);

  const cohortIds = new Set(cohortCustomers.map((customer) => customer._id.toString()));
  const newPatientIds = new Set(cohortCustomers
    .filter((customer) => customer.relationship?.status === "new")
    .map((customer) => customer._id.toString()));
  const profileCompleteIds = new Set(cohortCustomers
    .filter((customer) => customer.relationship?.status === "new" && isProfileComplete(customer.profile))
    .map((customer) => customer._id.toString()));
  const engagedIds = distinctCustomerIds(
    responseMessages.filter((message) => message.direction === "outbound"),
    profileCompleteIds,
  );
  const paymentRequestedIds = distinctCustomerIds(recentPayments, engagedIds);
  const paymentConfirmedIds = distinctCustomerIds(
    recentPayments.filter((payment) => payment.status === "paid"),
    paymentRequestedIds,
  );
  const scheduledIds = distinctCustomerIds(
    recentAppointments.filter((appointment) => (
      appointment.eventType === "doctor_consultation"
      && appointment.status !== "cancelled"
    )),
    paymentConfirmedIds,
  );
  const outboundMessages = responseMessages.filter((message) => message.direction === "outbound");
  const questionMessages = outboundMessages.filter((message) => message.body?.trim().endsWith("?"));
  const responseDurations = calculateResponseDurations(responseMessages);
  const paymentStatusCounts = countBy(recentPayments, (payment) => payment.status as string);
  const appointmentSourceCounts = countBy(recentAppointments, (appointment) => appointment.source as string);
  const currentQualifications = cohortCustomers.flatMap((customer) => {
    const qualification = customer.leadQualification;
    return qualification?.version === 2
      && qualification.generatedAt instanceof Date
      && Number.isFinite(qualification.profileFit?.score)
      && Number.isFinite(qualification.combinedFit?.score)
      ? [{
        customerId: customer._id,
        generatedAt: qualification.generatedAt,
        profileFit: { score: qualification.profileFit!.score! },
        combinedFit: { score: qualification.combinedFit!.score! },
      }]
      : [];
  });

  return {
    generatedAt: now,
    customerStatuses: Object.fromEntries(customerStatuses.map((item) => [item._id, item.count])),
    messageDirections: Object.fromEntries(messageDirections.map((item) => [item._id, item.count])),
    messageFailures,
    jobStatuses: Object.fromEntries(jobStatuses.map((item) => [item._id, item.count])),
    upcomingAppointments,
    appointmentsNextSevenDays,
    agentRunsLast24Hours,
    timezone,
    periodDays: 30,
    activitySeries: buildDailyActivity(now, timezone, dailyMessageCounts),
    leadFitSeries: buildDailyLeadFit(now, timezone, [...qualificationHistory, ...currentQualifications]),
    funnel: [
      { key: "contacts", label: "Contatos", count: cohortIds.size },
      { key: "new_patients", label: "Novos pacientes", count: newPatientIds.size },
      { key: "profile_complete", label: "Cadastro completo", count: profileCompleteIds.size },
      { key: "agent_engaged", label: "Atendimento do agente", count: engagedIds.size },
      { key: "payment_requested", label: "Sinal solicitado", count: paymentRequestedIds.size },
      { key: "payment_paid", label: "Sinal confirmado", count: paymentConfirmedIds.size },
      { key: "scheduled", label: "Consulta agendada", count: scheduledIds.size },
    ],
    agentRunStatuses: agentRunStatusCounts.map((item) => ({ key: item._id, count: item.count })),
    commercialMetrics: {
      newPatients: newPatientIds.size,
      returningPatients: cohortCustomers.filter((customer) => customer.relationship?.status === "returning").length,
      profileCompletionRate: percentage(profileCompleteIds.size, newPatientIds.size),
      paymentConfirmationRate: percentage(paymentConfirmedIds.size, paymentRequestedIds.size),
      schedulingRate: percentage(scheduledIds.size, newPatientIds.size),
      explicitQuestionRate: percentage(questionMessages.length, outboundMessages.length),
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

function buildDailyActivity(
  now: Date,
  timezone: string,
  counts: Array<{ _id: { date: string; direction: string }; count: number }>,
) {
  const countMap = new Map(counts.map((item) => [`${item._id.date}:${item._id.direction}`, item.count]));
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now.getTime() - (13 - index) * 24 * 60 * 60 * 1_000);
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    return {
      date: key,
      label: new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date),
      inbound: countMap.get(`${key}:inbound`) ?? 0,
      outbound: countMap.get(`${key}:outbound`) ?? 0,
    };
  });
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function buildDailyLeadFit(
  now: Date,
  timezone: string,
  qualifications: QualificationScoreDocument[],
) {
  const dailyCustomerScores = new Map<string, Map<string, QualificationScoreDocument>>();
  for (const qualification of qualifications) {
    const date = formatDateKey(qualification.generatedAt, timezone);
    const scores = dailyCustomerScores.get(date) ?? new Map<string, QualificationScoreDocument>();
    scores.set(qualification.customerId.toString(), qualification);
    dailyCustomerScores.set(date, scores);
  }

  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now.getTime() - (29 - index) * 24 * 60 * 60 * 1_000);
    const key = formatDateKey(date, timezone);
    const scores = [...(dailyCustomerScores.get(key)?.values() ?? [])];
    return {
      date: key,
      label: new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date),
      profileFit: scores.length > 0 ? Math.round(average(scores.map((item) => item.profileFit.score))) : null,
      combinedFit: scores.length > 0 ? Math.round(average(scores.map((item) => item.combinedFit.score))) : null,
      leadCount: scores.length,
    };
  });
}

function formatDateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}