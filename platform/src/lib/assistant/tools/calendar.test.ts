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
} = vi.hoisted(() => ({
  findCustomerById: vi.fn(),
  findSchedulingPlanOptions: vi.fn(),
  getCalendarSettings: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
  getLatestPaymentRequest: vi.fn(),
  getSchedulingPlanOption: vi.fn(),
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
});
