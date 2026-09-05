import "server-only";

import { ObjectId, type Collection } from "mongodb";
import clientPromise from "../../mongodb";
import type { SchedulingPlan } from "../../assistant/agent/contracts";
import { bookAppointment, findAvailableSlots, getCalendarSettings, updateCustomerAppointments } from "../calendar";
import {
  selectSchedulingPlanCandidates,
  type PlanCandidateStep,
  type SchedulingPreference,
} from "./engine";

export interface PlanSearchCriteria {
  stepKey: string;
  dateIntent: "exact_date" | "date_range" | "next_available";
  fromDate: string;
  toDate: string;
  period: "morning" | "afternoon" | "any";
  startTime: string | null;
}

export interface SchedulingPlanOptionDocument {
  _id: ObjectId;
  customerId: ObjectId;
  planKey: string;
  configRevision: number;
  preference: SchedulingPreference;
  steps: PlanCandidateStep[];
  purpose?: "book" | "reschedule";
  targetAppointmentIds?: ObjectId[];
  status: "proposed" | "processing" | "superseded" | "booked" | "rescheduled";
  expiresAt: Date;
  createdAt: Date;
  bookedAt?: Date;
  rescheduledAt?: Date;
  processingAt?: Date;
  supersededAt?: Date;
  appointmentGroupId?: ObjectId;
}

const DB_NAME = "ai_secretary";

async function getOptionsCollection(): Promise<Collection<SchedulingPlanOptionDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<SchedulingPlanOptionDocument>("calendar_plan_options");
}

export async function findSchedulingPlanOption(input: {
  customerId: ObjectId;
  plan: SchedulingPlan;
  configRevision: number;
  preference: SchedulingPreference;
  criteria: PlanSearchCriteria[];
}) {
  const result = await findSchedulingPlanOptions({ ...input, candidateCount: 1 });
  return { settings: result.settings, option: result.options[0] ?? null };
}

export async function findSchedulingPlanOptions(input: {
  customerId: ObjectId;
  plan: SchedulingPlan;
  configRevision: number;
  preference: SchedulingPreference;
  preferredTime?: string | null;
  criteria: PlanSearchCriteria[];
  candidateCount: number;
  purpose?: "book" | "reschedule";
  targetAppointmentIds?: ObjectId[];
}) {
  const settings = await getCalendarSettings();
  const criteriaByStep = new Map(input.criteria.map((criterion) => [criterion.stepKey, criterion]));
  const slotEntries = await Promise.all(input.plan.steps.map(async (step) => {
    const criterion = criteriaByStep.get(step.key);
    if (!criterion) return [step.key, [] as PlanCandidateStep["slot"][]] as const;
    const result = await findAvailableSlots({
      fromDate: criterion.fromDate,
      toDate: criterion.toDate,
      period: criterion.period,
      startTime: criterion.startTime,
      eventType: step.eventTypeKey,
      limit: 50,
      excludeAppointmentIds: input.targetAppointmentIds,
    });
    return [step.key, result.slots] as const;
  }));
  const options = await getOptionsCollection();
  await options.updateMany(
    { customerId: input.customerId, planKey: input.plan.key, status: "proposed" },
    { $set: { status: "superseded", supersededAt: new Date() } },
  );
  const candidates = selectSchedulingPlanCandidates({
    plan: input.plan,
    slotsByStep: new Map(slotEntries),
    preference: input.preference,
    preferredTime: input.preferredTime,
    offeredSignatures: new Set(),
    limit: input.candidateCount,
  });
  if (candidates.length === 0) return { settings, options: [] };
  const now = new Date();
  const proposed = candidates.map((candidate): SchedulingPlanOptionDocument => ({
    _id: new ObjectId(),
    customerId: input.customerId,
    planKey: input.plan.key,
    configRevision: input.configRevision,
    preference: input.preference,
    steps: candidate,
    purpose: input.purpose ?? "book",
    targetAppointmentIds: input.targetAppointmentIds,
    status: "proposed",
    expiresAt: new Date(now.getTime() + input.plan.proposalExpiryMinutes * 60_000),
    createdAt: now,
  }));
  await options.insertMany(proposed);
  await Promise.all([
    options.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    options.createIndex({ customerId: 1, createdAt: -1 }),
  ]);
  return { settings, options: proposed };
}

export async function getActiveSchedulingPlanOption(customerId: ObjectId, optionId?: ObjectId) {
  const options = await getOptionsCollection();
  const option = await options.findOne(
    {
      ...(optionId ? { _id: optionId } : {}),
      customerId,
      status: "proposed",
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1, _id: -1 } },
  );
  if (!option) return null;
  const serialized = serializeActiveOption(option);
  if (optionId) return serialized;

  const batch = await options.find({
    customerId,
    planKey: option.planKey,
    configRevision: option.configRevision,
    purpose: option.purpose,
    status: "proposed",
    expiresAt: { $gt: new Date() },
    createdAt: option.createdAt,
  }).sort({ _id: 1 }).toArray();
  const candidateStarts = batch.map((candidate) => Math.min(...candidate.steps.map((step) => new Date(step.slot.startAt).getTime())));
  const earliestStart = Math.min(...candidateStarts);
  const latestStart = Math.max(...candidateStarts);
  const candidates = batch.map((candidate, index) => ({
    ...serializeActiveOption(candidate),
    position: index + 1,
    isChronologicallyEarliest: candidateStarts[index] === earliestStart,
    isChronologicallyLatest: candidateStarts[index] === latestStart,
  }));
  const presentedCandidates = candidates.slice(0, 2).map((candidate, index, presented) => ({
    ...candidate,
    presentedPosition: index + 1,
    isFirstPresented: index === 0,
    isLastPresented: index === presented.length - 1,
  }));
  const lastPresented = presentedCandidates.at(-1) ?? serialized;
  return {
    ...lastPresented,
    candidateCount: candidates.length,
    candidates,
    presentedCandidateCount: presentedCandidates.length,
    presentedCandidates,
  };
}

function serializeActiveOption(option: SchedulingPlanOptionDocument) {
  return {
    optionId: option._id.toHexString(),
    planKey: option.planKey,
    configRevision: option.configRevision,
    purpose: option.purpose ?? "book",
    preference: option.preference,
    steps: option.steps,
    expiresAt: option.expiresAt.toISOString(),
  };
}

export async function getSchedulingPlanOption(customerId: ObjectId, optionId: ObjectId) {
  return (await getOptionsCollection()).findOne({
    _id: optionId,
    customerId,
    status: "proposed",
    expiresAt: { $gt: new Date() },
  });
}

export async function bookSchedulingPlanOption(input: {
  customerId: ObjectId;
  customerName: string;
  contactPhone: string;
  optionId: ObjectId;
  plan: SchedulingPlan;
  configRevision: number;
}) {
  const options = await getOptionsCollection();
  const option = await options.findOneAndUpdate({
    _id: input.optionId,
    customerId: input.customerId,
    planKey: input.plan.key,
    configRevision: input.configRevision,
    status: "proposed",
    purpose: { $ne: "reschedule" },
    expiresAt: { $gt: new Date() },
  }, { $set: { status: "processing", processingAt: new Date() } }, { returnDocument: "after" });
  if (!option) throw new Error("A opção expirou, foi substituída ou usa regras antigas. Consulte uma nova opção.");

  const appointmentGroupId = new ObjectId();
  const createdIds: ObjectId[] = [];
  try {
    for (const step of option.steps) {
      const appointment = await bookAppointment({
        customerId: input.customerId,
        customerName: input.customerName,
        contactPhone: input.contactPhone,
        startAt: step.slot.startAt,
        eventType: step.eventTypeKey,
        source: "assistant",
        visitGroupId: appointmentGroupId,
      });
      createdIds.push(appointment._id);
    }
  } catch (error) {
    if (createdIds.length > 0) {
      await (await clientPromise).db(DB_NAME).collection("calendar_appointments").deleteMany({ _id: { $in: createdIds } });
    }
    await options.updateOne(
      { _id: option._id, status: "processing" },
      { $set: { status: "proposed" }, $unset: { processingAt: "" } },
    );
    throw error;
  }
  await options.updateOne(
    { _id: option._id, status: "processing" },
    { $set: { status: "booked", bookedAt: new Date(), appointmentGroupId }, $unset: { processingAt: "" } },
  );
  return { settings: await getCalendarSettings(), option, appointmentGroupId };
}

export async function rescheduleSchedulingPlanOption(input: {
  customerId: ObjectId;
  optionId: ObjectId;
  plan: SchedulingPlan;
  configRevision: number;
}) {
  const options = await getOptionsCollection();
  const option = await options.findOneAndUpdate({
    _id: input.optionId,
    customerId: input.customerId,
    planKey: input.plan.key,
    configRevision: input.configRevision,
    purpose: "reschedule",
    status: "proposed",
    expiresAt: { $gt: new Date() },
  }, { $set: { status: "processing", processingAt: new Date() } }, { returnDocument: "after" });
  if (!option || option.targetAppointmentIds?.length !== option.steps.length) {
    throw new Error("A opção de reagendamento expirou ou não identifica os eventos atuais. Consulte novos horários.");
  }

  try {
    const appointments = await updateCustomerAppointments({
      customerId: input.customerId,
      appointments: option.steps.map((step, index) => ({
        appointmentId: option.targetAppointmentIds![index],
        startAt: step.slot.startAt,
        eventType: step.eventTypeKey,
      })),
    });
    await options.updateOne(
      { _id: option._id, status: "processing" },
      { $set: { status: "rescheduled", rescheduledAt: new Date() }, $unset: { processingAt: "" } },
    );
    return { settings: await getCalendarSettings(), option, appointments };
  } catch (error) {
    await options.updateOne(
      { _id: option._id, status: "processing" },
      { $set: { status: "proposed" }, $unset: { processingAt: "" } },
    );
    throw error;
  }
}