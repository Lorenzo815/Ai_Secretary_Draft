import "server-only";

import type { ObjectId } from "mongodb";
import { scheduleAutomationJob } from "../automation/queue";
import {
  claimQualificationMilestone,
  isFirstCustomerAppointment,
  releaseQualificationMilestone,
  type QualificationMilestone,
} from "./milestones";

export async function scheduleProfileCompletionQualification(
  customerId: ObjectId,
  missingFields: string[],
  occurredAt = new Date(),
) {
  if (missingFields.length > 0) return false;
  return scheduleMilestoneQualification(customerId, "profile_completed", occurredAt);
}

export async function scheduleFirstAppointmentQualification(
  customerId: ObjectId,
  appointmentIds: ObjectId | ObjectId[],
  occurredAt = new Date(),
) {
  const ids = Array.isArray(appointmentIds) ? appointmentIds : [appointmentIds];
  if (!(await isFirstCustomerAppointment(customerId, ids))) return false;
  return scheduleMilestoneQualification(
    customerId,
    "first_appointment_confirmed",
    occurredAt,
    { appointmentId: ids[0].toHexString() },
  );
}

async function scheduleMilestoneQualification(
  customerId: ObjectId,
  milestone: QualificationMilestone,
  occurredAt: Date,
  payload: Record<string, unknown> = {},
) {
  const claimed = await claimQualificationMilestone(customerId, milestone, occurredAt);
  if (!claimed) return false;

  try {
    await scheduleAutomationJob({
      process: "lead_qualification",
      event: {
        type: milestone === "profile_completed"
          ? "customer.profile.updated"
          : "appointment.status.changed",
        customerId,
        occurredAt,
        payload: { reason: milestone, ...payload },
      },
      debounceMs: 0,
    });
    return true;
  } catch (error) {
    await releaseQualificationMilestone(customerId, milestone);
    throw error;
  }
}