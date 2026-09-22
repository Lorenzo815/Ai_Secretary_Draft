import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentConfiguration } from "../agent/defaults";

const {
  findCustomerById,
  findSchedulingPlanOptions,
  getCalendarSettings,
  getCustomerProfileSnapshot,
  getLatestPaymentRequest,
  getSchedulingPlanOption,
  holdSchedulingPlanOption,
} = vi.hoisted(() => ({
  findCustomerById: vi.fn(),
  findSchedulingPlanOptions: vi.fn(),
  getCalendarSettings: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
  getLatestPaymentRequest: vi.fn(),
  getSchedulingPlanOption: vi.fn(),
  holdSchedulingPlanOption: vi.fn(),
}));

vi.mock("../../calendar", () => ({
  bookAppointment: vi.fn(),
  findAvailableSlots: vi.fn(),
  findCustomerAppointments: vi.fn(),
  getCalendarSettings,
  updateCustomerAppointments: vi.fn(),
}));
vi.mock("../../calendar/plans", () => ({
  bookSchedulingPlanOption: vi.fn(),
  findSchedulingPlanOption: vi.fn(),
  findSchedulingPlanOptions,
  getActiveSchedulingPlanOption: vi.fn(),
  getSchedulingPlanOption,
  holdSchedulingPlanOption,
  rescheduleSchedulingPlanOption: vi.fn(),
}));
vi.mock("../../crm", () => ({
  findCustomerById,
  getCustomerProfileSnapshot,
}));
vi.mock("../../payments", () => ({ getLatestPaymentRequest }));

import { executeRegisteredCalendarTool } from "./calendar";

describe("calendar plan prerequisites", () => {
  const customerId = new ObjectId();
  const configuration = createDefaultAgentConfiguration();
  const context = {
    customerId,
    customerName: "Cliente",
    contactPhone: "5511999999999",
    configuration,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCalendarSettings.mockResolvedValue({
      timezone: "America/Sao_Paulo",
      eventTypes: [
        { key: "bioimpedance", name: "Bioimpedância", durationMinutes: 30 },
        { key: "doctor_consultation", name: "Consulta Dr.", durationMinutes: 60 },
      ],
    });
    findSchedulingPlanOptions.mockResolvedValue({
      settings: { timezone: "America/Sao_Paulo" },
      options: [],
    });
  });

  it("allows read-only availability lookup before profile and payment prerequisites", async () => {
    const execution = await executeRegisteredCalendarTool("find_slots", context, {
      purpose: "book",
      eventType: null,
      planKey: "first_visit",
      dateIntent: "next_available",
      fromDate: "2026-09-21",
      horizonDays: 14,
      period: "any",
      preferredTime: null,
      ranking: "compact",
      candidateCount: 2,
      stepCriteria: [],
    });

    expect(JSON.parse(execution!.output)).toMatchObject({
      ok: true,
      tool: "calendar.find_slots",
    });
    expect(findSchedulingPlanOptions).toHaveBeenCalledOnce();
    expect(findCustomerById).not.toHaveBeenCalled();
    expect(getLatestPaymentRequest).not.toHaveBeenCalled();
  });

  it("rejects a calendar event type that is hidden from the agent", async () => {
    getCalendarSettings.mockResolvedValue({
      timezone: "America/Sao_Paulo",
      eventTypes: [
        { key: "doctor_consultation", name: "Consulta Dr.", durationMinutes: 60 },
        { key: "internal_procedure", name: "Procedimento interno", durationMinutes: 30 },
      ],
    });

    const execution = await executeRegisteredCalendarTool("find_slots", context, {
      purpose: "book",
      eventType: "internal_procedure",
      planKey: null,
      dateIntent: "next_available",
      fromDate: "2026-09-21",
      horizonDays: 14,
      period: "any",
      preferredTime: null,
      ranking: "earliest",
      candidateCount: 2,
      stepCriteria: [],
    });

    expect(JSON.parse(execution!.output)).toMatchObject({
      ok: false,
      type: "validation_error",
      errors: [expect.objectContaining({ field: "arguments.eventType" })],
    });
    expect(findSchedulingPlanOptions).not.toHaveBeenCalled();
  });

  it("still enforces plan prerequisites before booking", async () => {
    getSchedulingPlanOption.mockResolvedValue({
      _id: new ObjectId(),
      planKey: "first_visit",
    });
    findCustomerById.mockResolvedValue({ _id: customerId });
    getCustomerProfileSnapshot.mockReturnValue({});
    getLatestPaymentRequest.mockResolvedValue(null);

    const execution = await executeRegisteredCalendarTool("book", context, {
      candidateId: new ObjectId().toString(),
      confirmedByCustomer: true,
    });
    const result = JSON.parse(execution!.output);

    expect(result).toMatchObject({
      ok: false,
      type: "validation_error",
    });
    expect(result.errors[0]).toMatchObject({ field: "prerequisites" });
    expect(findSchedulingPlanOptions).not.toHaveBeenCalled();
  });

  it("holds only an explicitly confirmed candidate before payment", async () => {
    const optionId = new ObjectId();
    const expiresAt = new Date("2026-09-23T15:00:00.000Z");
    const option = {
      _id: optionId,
      customerId,
      planKey: "first_visit",
      configRevision: configuration.revision,
      preference: "compact",
      purpose: "book",
      status: "proposed",
      expiresAt,
      createdAt: new Date(),
      steps: [
        {
          stepKey: "assessment",
          eventTypeKey: "bioimpedance",
          slot: { startAt: "2026-09-24T12:00:00.000Z" },
        },
        {
          stepKey: "consultation",
          eventTypeKey: "doctor_consultation",
          slot: { startAt: "2026-09-24T12:30:00.000Z" },
        },
      ],
    };
    getSchedulingPlanOption.mockResolvedValue(option);
    findCustomerById.mockResolvedValue({ _id: customerId });
    getCustomerProfileSnapshot.mockReturnValue({ missingFields: [] });
    getLatestPaymentRequest.mockResolvedValue(null);
    holdSchedulingPlanOption.mockResolvedValue({
      option,
      appointmentGroupId: new ObjectId(),
      holdExpiresAt: expiresAt,
      settings: { timezone: "America/Sao_Paulo" },
    });

    const execution = await executeRegisteredCalendarTool("hold", context, {
      candidateId: optionId.toString(),
      confirmedByCustomer: true,
    });

    expect(JSON.parse(execution!.output)).toMatchObject({
      ok: true,
      tool: "calendar.hold",
      holdExpiresAt: expiresAt.toISOString(),
    });
    expect(holdSchedulingPlanOption).toHaveBeenCalledWith(expect.objectContaining({
      customerId,
      optionId,
      plan: expect.objectContaining({ key: "first_visit", holdDurationMinutes: 48 * 60 }),
    }));
  });

  it("does not hold an option without explicit customer confirmation", async () => {
    const execution = await executeRegisteredCalendarTool("hold", context, {
      candidateId: new ObjectId().toString(),
      confirmedByCustomer: false,
    });

    expect(JSON.parse(execution!.output)).toMatchObject({
      ok: false,
      type: "validation_error",
    });
    expect(holdSchedulingPlanOption).not.toHaveBeenCalled();
  });
});
