import "server-only";

import { MongoServerError, type ObjectId } from "mongodb";
import { withCurrentCompany } from "../companies/context";
import { tenantDb } from "../companies/tenant-db";

export type QualificationMilestone = "profile_completed" | "first_appointment_confirmed";

const DB_NAME = "ai_secretary";

interface QualificationMilestoneDocument {
  _id: string;
  customerId: ObjectId;
  milestone: QualificationMilestone;
  occurredAt: Date;
  createdAt: Date;
}

interface AppointmentReference {
  _id: ObjectId;
  customerId: ObjectId;
  createdAt: Date;
}

export async function claimQualificationMilestone(
  customerId: ObjectId,
  milestone: QualificationMilestone,
  occurredAt: Date,
) {
  try {
    await (await tenantDb()).collection<QualificationMilestoneDocument>("qualification_milestones").insertOne(await withCurrentCompany({
      _id: `${customerId.toHexString()}:${milestone}`,
      customerId,
      milestone,
      occurredAt,
      createdAt: new Date(),
    }));
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

export async function releaseQualificationMilestone(
  customerId: ObjectId,
  milestone: QualificationMilestone,
) {
  await (await tenantDb()).collection<QualificationMilestoneDocument>("qualification_milestones").deleteOne({
    _id: `${customerId.toHexString()}:${milestone}`,
  });
}

export async function isFirstCustomerAppointment(
  customerId: ObjectId,
  appointmentIds: ObjectId[],
) {
  const firstAppointment = await (await tenantDb())
    .collection<AppointmentReference>("calendar_appointments")
    .findOne({ customerId }, { projection: { _id: 1 }, sort: { createdAt: 1, _id: 1 } });
  return Boolean(firstAppointment && appointmentIds.some((id) => id.equals(firstAppointment._id)));
}