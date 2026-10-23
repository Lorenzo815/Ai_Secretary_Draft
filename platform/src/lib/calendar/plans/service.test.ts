import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  updateCustomerAppointments: vi.fn(),
  startSession: vi.fn(),
  withTransaction: vi.fn(),
  endSession: vi.fn(),
  find: vi.fn(),
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
        find: mocks.find,
      }),
    }),
    startSession: mocks.startSession,
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
  updateCustomerAppointments: mocks.updateCustomerAppointments,
}));

import { findSchedulingPlanOptions, getActiveSchedulingPlanOption, holdSchedulingPlanOption, rescheduleSchedulingPlanOption, type SchedulingPlanOptionDocument } from "./service";

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

describe("rescheduling existing appointment holds", () => {
  const now = new Date("2026-10-23T16:00:00Z");
  const session = { withTransaction: mocks.withTransaction, endSession: mocks.endSession };
  let option: SchedulingPlanOptionDocument;
  let heldOptionId: ObjectId;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    heldOptionId = new ObjectId();
    option = {
      _id: new ObjectId(), customerId: new ObjectId(), planKey: plan.key, configRevision: 10,
      preference: "compact", purpose: "reschedule", status: "proposed",
      targetAppointmentStatus: "held", targetAppointmentIds: [new ObjectId(), new ObjectId()],
      createdAt: now, expiresAt: new Date("2026-10-23T16:30:00Z"),
      steps: [
        { stepKey: "assessment", eventTypeKey: "bioimpedance", slot: slot("2026-10-26T13:00:00-03:00", "2026-10-26T13:15:00-03:00") },
        { stepKey: "consultation", eventTypeKey: "doctor_consultation", slot: slot("2026-10-26T13:15:00-03:00", "2026-10-26T14:45:00-03:00") },
      ],
    };
    mocks.startSession.mockReturnValue(session);
    mocks.withTransaction.mockImplementation(async (callback: () => Promise<unknown>) => callback());
    mocks.getCalendarSettings.mockResolvedValue({ timezone: "America/Sao_Paulo" });
    mocks.findOneAndUpdate.mockResolvedValue(option);
    mocks.findOne.mockResolvedValue({ ...option, _id: heldOptionId, status: "held" });
    mocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mocks.updateCustomerAppointments.mockResolvedValue(option.targetAppointmentIds!.map(_id => ({
      _id, customerId: option.customerId, schedulingOptionId: heldOptionId, status: "held",
    })));
    mocks.find.mockReturnValue({ sort: () => ({ toArray: async () => [option] }) });
  });
  afterEach(() => vi.useRealTimers());

  function reschedule() {
    return rescheduleSchedulingPlanOption({
      customerId: option.customerId, optionId: option._id, plan, configRevision: 10,
    });
  }

  it("moves the same appointment IDs, renews expiry and consumes the candidate in one transaction", async () => {
    const result = await reschedule();
    const expiresAt = new Date("2026-10-23T18:00:00Z");

    expect(result).toMatchObject({ status: "held", holdExpiresAt: expiresAt });
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      _id: option._id, customerId: option.customerId, configRevision: 10,
      purpose: "reschedule", status: "proposed", expiresAt: { $gt: now },
    }), expect.anything(), { returnDocument: "after", session });
    expect(mocks.findOne).toHaveBeenCalledWith({
      _id: heldOptionId, customerId: option.customerId, planKey: plan.key,
      status: "held", expiresAt: { $gt: now },
    }, { session });
    expect(mocks.updateCustomerAppointments).toHaveBeenCalledWith({
      customerId: option.customerId,
      appointments: option.steps.map((step, index) => ({
        appointmentId: option.targetAppointmentIds![index], startAt: step.slot.startAt, eventType: step.eventTypeKey,
      })),
      hold: { expiresAt }, session,
    });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: heldOptionId, customerId: option.customerId, status: "held" }),
      { $set: { steps: option.steps, configRevision: 10, heldAt: now, expiresAt } },
      { session },
    );
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: option._id, status: "processing" },
      { $set: { status: "rescheduled", rescheduledAt: now }, $unset: { processingAt: "" } },
      { session },
    );
    expect(mocks.holdAppointment).not.toHaveBeenCalled();
    expect(mocks.replaceAppointmentHolds).not.toHaveBeenCalled();
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("caps the renewed expiry at the first new appointment start", async () => {
    option.steps[0].slot = slot("2026-10-23T13:45:00-03:00", "2026-10-23T14:00:00-03:00");

    expect((await reschedule()).holdExpiresAt).toEqual(new Date("2026-10-23T16:45:00Z"));
  });

  it("keeps scheduled-target behavior without renewing a hold or requiring legacy metadata", async () => {
    delete option.targetAppointmentStatus;
    mocks.updateCustomerAppointments.mockResolvedValue(option.targetAppointmentIds!.map(_id => ({ _id, status: "scheduled" })));

    const result = await reschedule();

    expect(result).toMatchObject({ status: "scheduled", holdExpiresAt: null });
    expect(mocks.updateCustomerAppointments.mock.calls[0][0]).not.toHaveProperty("hold");
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.updateOne).toHaveBeenCalledOnce();
  });

  it("does not consume the candidate when availability validation fails", async () => {
    mocks.updateCustomerAppointments.mockRejectedValueOnce(new Error("Slot conflict"));

    await expect(reschedule()).rejects.toThrow("Slot conflict");

    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("refuses a partial plan move or an expired source hold", async () => {
    mocks.findOne.mockResolvedValueOnce({ steps: [option.steps[0]] }).mockResolvedValueOnce(null);

    await expect(reschedule()).rejects.toThrow("todas as etapas");
    await expect(reschedule()).rejects.toThrow("expirou");

    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("refuses to combine appointments from different held options", async () => {
    mocks.updateCustomerAppointments.mockResolvedValue(option.targetAppointmentIds!.map(_id => ({
      _id, schedulingOptionId: new ObjectId(), status: "held",
    })));

    await expect(reschedule()).rejects.toThrow("um único plano");
    expect(mocks.findOne).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("aborts if the source hold changes while being renewed", async () => {
    mocks.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(reschedule()).rejects.toThrow("alterada por outra operação");
  });

  it("aborts if the rescheduling candidate cannot be consumed", async () => {
    mocks.updateOne.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });

    await expect(reschedule()).rejects.toThrow("alterada por outra operação");
    expect(mocks.endSession).toHaveBeenCalledOnce();
  });

  it("rejects already-consumed or unidentifiable candidates before moving appointments", async () => {
    mocks.findOneAndUpdate.mockResolvedValueOnce(null);

    await expect(reschedule()).rejects.toThrow("expirou");
    expect(mocks.updateCustomerAppointments).not.toHaveBeenCalled();
  });

  it("exposes rescheduling choices ahead of the existing hold during customer confirmation", async () => {
    const active = await getActiveSchedulingPlanOption(option.customerId);

    expect(mocks.findOne).toHaveBeenCalledWith(expect.objectContaining({
      customerId: option.customerId, status: "proposed", purpose: "reschedule",
    }), expect.anything());
    expect(active).toMatchObject({
      optionId: option._id.toHexString(), purpose: "reschedule", targetAppointmentStatus: "held",
      presentedCandidates: [expect.objectContaining({ optionId: option._id.toHexString() })],
    });
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
