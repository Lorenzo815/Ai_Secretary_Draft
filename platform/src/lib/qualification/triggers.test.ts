import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimQualificationMilestone,
  isFirstCustomerAppointment,
  releaseQualificationMilestone,
  scheduleAutomationJob,
} = vi.hoisted(() => ({
  claimQualificationMilestone: vi.fn(),
  isFirstCustomerAppointment: vi.fn(),
  releaseQualificationMilestone: vi.fn(),
  scheduleAutomationJob: vi.fn(),
}));

vi.mock("../automation/queue", () => ({ scheduleAutomationJob }));
vi.mock("./milestones", () => ({
  claimQualificationMilestone,
  isFirstCustomerAppointment,
  releaseQualificationMilestone,
}));

import {
  scheduleFirstAppointmentQualification,
  scheduleProfileCompletionQualification,
} from "./triggers";

describe("qualification milestone triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirstCustomerAppointment.mockResolvedValue(true);
  });

  it("schedules profile qualification only after the profile is complete and unclaimed", async () => {
    const customerId = new ObjectId();
    const occurredAt = new Date("2026-03-18T12:00:00.000Z");

    expect(await scheduleProfileCompletionQualification(customerId, ["cpf"], occurredAt)).toBe(false);
    expect(claimQualificationMilestone).not.toHaveBeenCalled();

    claimQualificationMilestone.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await scheduleProfileCompletionQualification(customerId, [], occurredAt)).toBe(true);
    expect(await scheduleProfileCompletionQualification(customerId, [], occurredAt)).toBe(false);

    expect(scheduleAutomationJob).toHaveBeenCalledTimes(1);
    expect(scheduleAutomationJob).toHaveBeenCalledWith(expect.objectContaining({
      process: "lead_qualification",
      event: expect.objectContaining({
        type: "customer.profile.updated",
        customerId,
        payload: { reason: "profile_completed" },
      }),
    }));
  });

  it("schedules the first appointment qualification with its appointment id", async () => {
    const customerId = new ObjectId();
    const appointmentId = new ObjectId();
    claimQualificationMilestone.mockResolvedValue(true);

    await scheduleFirstAppointmentQualification(customerId, appointmentId);

    expect(scheduleAutomationJob).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        type: "appointment.status.changed",
        payload: {
          reason: "first_appointment_confirmed",
          appointmentId: appointmentId.toHexString(),
        },
      }),
    }));
  });

  it("does not schedule qualification for a later appointment", async () => {
    isFirstCustomerAppointment.mockResolvedValue(false);

    expect(await scheduleFirstAppointmentQualification(new ObjectId(), new ObjectId())).toBe(false);
    expect(claimQualificationMilestone).not.toHaveBeenCalled();
    expect(scheduleAutomationJob).not.toHaveBeenCalled();
  });

  it("releases the milestone when scheduling fails", async () => {
    const customerId = new ObjectId();
    claimQualificationMilestone.mockResolvedValue(true);
    scheduleAutomationJob.mockRejectedValue(new Error("queue unavailable"));

    await expect(scheduleProfileCompletionQualification(customerId, []))
      .rejects.toThrow("queue unavailable");
    expect(releaseQualificationMilestone)
      .toHaveBeenCalledWith(customerId, "profile_completed");
  });
});