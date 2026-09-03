import "server-only";

import { ObjectId, type Collection } from "mongodb";
import clientPromise from "../../mongodb";
import type { SchedulingPlan } from "../../assistant/agent/contracts";
import { bookAppointment, findAvailableSlots, getCalendarSettings } from "../calendar";
import {
  candidateSignature,
  selectSchedulingPlanCandidate,
  type PlanCandidateStep,
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
  preference: "compact" | "flexible";
  steps: PlanCandidateStep[];
  status: "proposed" | "superseded" | "booked";
  expiresAt: Date;
  createdAt: Date;
  bookedAt?: Date;
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
  preference: "compact" | "flexible";
  criteria: PlanSearchCriteria[];
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
    });
    return [step.key, result.slots] as const;
  }));
  const options = await getOptionsCollection();
  const previous = await options.find({ customerId: input.customerId, planKey: input.plan.key }).toArray();
  await options.updateMany(
    { customerId: input.customerId, planKey: input.plan.key, status: "proposed" },
    { $set: { status: "superseded", supersededAt: new Date() } },
  );
  const candidate = selectSchedulingPlanCandidate({
    plan: input.plan,
    slotsByStep: new Map(slotEntries),
    preference: input.preference,
    offeredSignatures: new Set(previous.map((option) => candidateSignature(option.steps))),
  });
  if (!candidate) return { settings, option: null };
  const now = new Date();
  const option: SchedulingPlanOptionDocument = {
    _id: new ObjectId(),
    customerId: input.customerId,
    planKey: input.plan.key,
    configRevision: input.configRevision,
    preference: input.preference,
    steps: candidate,
    status: "proposed",
    expiresAt: new Date(now.getTime() + input.plan.proposalExpiryMinutes * 60_000),
    createdAt: now,
  };
  await options.insertOne(option);
  await Promise.all([
    options.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    options.createIndex({ customerId: 1, createdAt: -1 }),
  ]);
  return { settings, option };
}

export async function getActiveSchedulingPlanOption(customerId: ObjectId, optionId?: ObjectId) {
  const option = await (await getOptionsCollection()).findOne(
    {
      ...(optionId ? { _id: optionId } : {}),
      customerId,
      status: "proposed",
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } },
  );
  if (!option) return null;
  return {
    optionId: option._id.toHexString(),
    planKey: option.planKey,
    configRevision: option.configRevision,
    preference: option.preference,
    steps: option.steps,
    expiresAt: option.expiresAt.toISOString(),
  };
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
  const option = await options.findOne({
    _id: input.optionId,
    customerId: input.customerId,
    planKey: input.plan.key,
    configRevision: input.configRevision,
    status: "proposed",
    expiresAt: { $gt: new Date() },
  });
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
    throw error;
  }
  await options.updateOne(
    { _id: option._id, status: "proposed" },
    { $set: { status: "booked", bookedAt: new Date(), appointmentGroupId } },
  );
  return { settings: await getCalendarSettings(), option, appointmentGroupId };
}