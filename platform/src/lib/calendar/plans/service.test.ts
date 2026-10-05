import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchedulingPlan } from "../../assistant/agent/contracts";

const mocks = vi.hoisted(() => ({
  createIndex: vi.fn(),
  findAvailableSlots: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  getCalendarSettings: vi.fn(),
  holdAppointment: vi.fn(),
  insertMany: vi.fn(),
  listActiveAppointmentHoldIds: vi.fn(),
  releaseAppointmentHolds: vi.fn(),
  replaceAppointmentHolds: vi.fn(),
  updateMany: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("../../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        createIndex: mocks.createIndex,
        findOne: mocks.findOne,
        findOneAndUpdate: mocks.findOneAndUpdate,
        insertMany: mocks.insertMany,
        updateMany: mocks.updateMany,
        updateOne: mocks.updateOne,
      }),
    }),
  }),
}));
vi.mock("../../qualification/triggers", () => ({
  scheduleFirstAppointmentQualification: vi.fn(),
}));
vi.mock("../calendar", () => ({
  bookAppointment: vi.fn(),
  confirmAppointmentHolds: vi.fn(),
  findAvailableSlots: mocks.findAvailableSlots,
  getCalendarSettings: mocks.getCalendarSettings,
  holdAppointment: mocks.holdAppointment,
  listActiveAppointmentHoldIds: mocks.listActiveAppointmentHoldIds,
  releaseAppointmentHolds: mocks.releaseAppointmentHolds,
  replaceAppointmentHolds: mocks.replaceAppointmentHolds,
  updateCustomerAppointments: vi.fn(),
}));

import { findSchedulingPlanOptions, holdSchedulingPlanOption } from "./service";

const plan: SchedulingPlan = {
  key: "first_visit",
  name: "Primeira consulta",
  description: "Bio antes da consulta.",
  enabled: true,
  steps: [
    { key: "assessment", eventTypeKey: "bioimpedance", label: "Bioimpedância", required: true },
    { key: "consultation", eventTypeKey: "doctor_consultation", label: "Consulta", required: true },
  ],
  constraints: [{ type: "ordered", before: "assessment", after: "consultation" }],
  prerequisites: { all: [] },
  proposalExpiryMinutes: 60,
  holdDurationMinutes: 120,
};

describe("temporary scheduling option replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCalendarSettings.mockResolvedValue({ timezone: "America/Sao_Paulo" });
    mocks.updateMany.mockResolvedValue({ modifiedCount: 1 });
    mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.insertMany.mockResolvedValue({ insertedCount: 1 });
    mocks.createIndex.mockResolvedValue("index");
  });

  it("excludes the customer's active hold while searching replacement candidates", async () => {
    const customerId = new ObjectId();
    const activeOptionId = new ObjectId();
    const heldAppointmentIds = [new ObjectId(), new ObjectId()];
    mocks.findOne.mockResolvedValue({ _id: activeOptionId });
    mocks.listActiveAppointmentHoldIds.mockResolvedValue(heldAppointmentIds);
    mocks.findAvailableSlots.mockImplementation(async (input: { eventType: string }) => ({
      slots: input.eventType === "bioimpedance"
        ? [slot("2026-10-21T13:30:00.000-03:00", "2026-10-21T13:45:00.000-03:00")]
        : [slot("2026-10-21T13:45:00.000-03:00", "2026-10-21T15:15:00.000-03:00")],
    }));

    const result = await findSchedulingPlanOptions({
      customerId,
      plan,
      configRevision: 10,
      preference: "compact",
      candidateCount: 2,
      purpose: "book",
      criteria: plan.steps.map((step) => ({
        stepKey: step.key,
        dateIntent: "exact_date",
        fromDate: "2026-10-21",
        toDate: "2026-10-21",
        period: "afternoon",
        startTime: null,
      })),
    });

    expect(result.options).toHaveLength(1);
    expect(mocks.listActiveAppointmentHoldIds).toHaveBeenCalledWith(customerId, activeOptionId);
    expect(mocks.findAvailableSlots).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.findAvailableSlots.mock.calls) {
      expect(input.excludeAppointmentIds).toEqual(heldAppointmentIds);
    }
  });

  it("atomically replaces an active hold when the customer chooses a new candidate", async () => {
    const customerId = new ObjectId();
    const currentOptionId = new ObjectId();
    const nextOptionId = new ObjectId();
    const nextOption = {
      _id: nextOptionId,
      customerId,
      planKey: plan.key,
      configRevision: 10,
      preference: "compact",
      status: "processing",
      expiresAt: new Date("2099-10-06T15:00:00.000Z"),
      createdAt: new Date(),
      steps: [
        {
          stepKey: "assessment",
          eventTypeKey: "bioimpedance",
          slot: slot("2099-10-21T13:30:00.000-03:00", "2099-10-21T13:45:00.000-03:00"),
        },
        {
          stepKey: "consultation",
          eventTypeKey: "doctor_consultation",
          slot: slot("2099-10-21T13:45:00.000-03:00", "2099-10-21T15:15:00.000-03:00"),
        },
      ],
    };
    mocks.findOne.mockResolvedValue({ _id: currentOptionId });
    mocks.findOneAndUpdate.mockResolvedValue(nextOption);
    mocks.replaceAppointmentHolds.mockResolvedValue([]);
    mocks.releaseAppointmentHolds.mockResolvedValue(0);

    await holdSchedulingPlanOption({
      customerId,
      customerName: "Lorenzo",
      contactPhone: "5542999999999",
      optionId: nextOptionId,
      plan,
      configRevision: 10,
    });

    expect(mocks.replaceAppointmentHolds).toHaveBeenCalledWith(expect.objectContaining({
      customerId,
      currentSchedulingOptionId: currentOptionId,
      nextSchedulingOptionId: nextOptionId,
      appointments: [
        { startAt: "2099-10-21T13:30:00.000-03:00", eventType: "bioimpedance" },
        { startAt: "2099-10-21T13:45:00.000-03:00", eventType: "doctor_consultation" },
      ],
    }));
    expect(mocks.holdAppointment).not.toHaveBeenCalled();
    expect(mocks.releaseAppointmentHolds).toHaveBeenCalledWith(customerId, expect.any(ObjectId));
  });

  it("leaves the active hold untouched when its transactional replacement fails", async () => {
    const customerId = new ObjectId();
    const currentOptionId = new ObjectId();
    const nextOptionId = new ObjectId();
    mocks.findOne.mockResolvedValue({ _id: currentOptionId });
    mocks.findOneAndUpdate.mockResolvedValue({
      _id: nextOptionId,
      customerId,
      planKey: plan.key,
      configRevision: 10,
      preference: "compact",
      status: "processing",
      expiresAt: new Date("2099-10-06T15:00:00.000Z"),
      createdAt: new Date(),
      steps: [{
        stepKey: "assessment",
        eventTypeKey: "bioimpedance",
        slot: slot("2099-10-21T13:30:00.000-03:00", "2099-10-21T13:45:00.000-03:00"),
      }],
    });
    mocks.replaceAppointmentHolds.mockRejectedValue(new Error("slot conflict"));

    await expect(holdSchedulingPlanOption({
      customerId,
      customerName: "Lorenzo",
      contactPhone: "5542999999999",
      optionId: nextOptionId,
      plan,
      configRevision: 10,
    })).rejects.toThrow("slot conflict");

    expect(mocks.releaseAppointmentHolds).not.toHaveBeenCalled();
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: nextOptionId, status: "processing" },
      {
        $set: { status: "proposed" },
        $unset: { processingAt: "" },
      },
    );
  });
});

function slot(startAt: string, endAt: string) {
  return {
    startAt,
    endAt,
    localDate: startAt.slice(0, 10),
    localTime: startAt.slice(11, 16),
    weekday: 3,
    weekdayLabel: "quarta-feira",
    timezone: "America/Sao_Paulo",
    gapWasteMinutes: 0,
    label: startAt,
  };
}
