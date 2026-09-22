import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerDocument } from "../../crm";
import { createDefaultAgentConfiguration } from "./defaults";

const mocks = vi.hoisted(() => ({
  getActiveSchedulingPlanOption: vi.fn(),
  getCalendarSettings: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
  getLatestPaymentRequest: vi.fn(),
}));

vi.mock("../../calendar", () => ({
  getActiveSchedulingPlanOption: mocks.getActiveSchedulingPlanOption,
  getCalendarSettings: mocks.getCalendarSettings,
}));
vi.mock("../../payments", () => ({ getLatestPaymentRequest: mocks.getLatestPaymentRequest }));
vi.mock("../../crm", () => ({ getCustomerProfileSnapshot: mocks.getCustomerProfileSnapshot }));

import { buildAgentRuntimeContext } from "./runtime-context";

describe("agent runtime event authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCalendarSettings.mockResolvedValue({
      timezone: "America/Sao_Paulo",
      resources: [
        { id: "doctor", name: "Dr. Matheus" },
        { id: "technician", name: "Técnica" },
      ],
      eventTypes: [
        { key: "doctor_consultation", name: "Consulta", durationMinutes: 90, resourceId: "doctor" },
        { key: "internal_procedure", name: "Procedimento interno", durationMinutes: 30, resourceId: "technician" },
      ],
    });
    mocks.getLatestPaymentRequest.mockResolvedValue(null);
    mocks.getCustomerProfileSnapshot.mockReturnValue({ missingFields: [] });
  });

  it("exposes only authorized event types and plans to the model", async () => {
    const configuration = createDefaultAgentConfiguration();
    configuration.bookableEventTypeKeys = ["doctor_consultation"];
    mocks.getActiveSchedulingPlanOption.mockResolvedValue({
      optionId: new ObjectId().toString(),
      planKey: "event:internal_procedure",
    });

    const now = new Date();
    const customer: CustomerDocument = {
      _id: new ObjectId(),
      phones: ["5511999999999"],
      identifiers: [],
      name: "Cliente",
      serviceStatus: "ai_active",
      firstInteractionAt: now,
      lastInteractionAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const runtime = await buildAgentRuntimeContext({
      customer,
      configuration,
      trigger: "inbound_message",
      iteration: 1,
    });

    expect(runtime.clinic.eventTypes.map((eventType) => eventType.key)).toEqual(["doctor_consultation"]);
    expect(runtime.clinic.schedulingPlans).toEqual([]);
    expect(runtime.operations.activeSchedulingOption).toBeNull();
  });
});
