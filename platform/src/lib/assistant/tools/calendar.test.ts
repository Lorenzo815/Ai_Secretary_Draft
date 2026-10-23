import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentConfiguration } from "../agent/defaults";

const {
  findCustomerById,
  findCustomerAppointments,
  findUpcomingCustomerAppointments,
  findSchedulingPlanOptions,
  getCalendarSettings,
  getCustomerProfileSnapshot,
  getLatestPaymentRequest,
  getSchedulingPlanOption,
  holdSchedulingPlanOption,
} = vi.hoisted(() => ({
  findCustomerById: vi.fn(),
  findCustomerAppointments: vi.fn(),
  findUpcomingCustomerAppointments: vi.fn(),
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
  findCustomerAppointments,
  findUpcomingCustomerAppointments,
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

import { executeRegisteredCalendarTool, executeUpcomingAppointmentsTool } from "./calendar";
import { executeAgentTool } from "../agent/tool-policy";
import type { ToolExecutionContext } from "./contracts";

describe("calendar tools", () => {
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

  describe("runtime-scoped upcoming appointment lookup", () => {
      let context: ToolExecutionContext;

      beforeEach(() => {
        vi.clearAllMocks();
        context = {
          customerId: new ObjectId(),
          customerName: "Current customer",
          contactPhone: "",
          configuration: createDefaultAgentConfiguration(),
        };
        getCalendarSettings.mockResolvedValue({
          timezone: "America/Sao_Paulo",
          eventTypes: [
            { key: "consultation", name: "Consulta", resourceId: "doctor" },
            { key: "follow_up", name: "Retorno", resourceId: "doctor" },
            { key: "internal", name: "Internal event", resourceId: "doctor" },
          ],
          resources: [{ id: "doctor", name: "Test Doctor" }],
        });
        findUpcomingCustomerAppointments.mockResolvedValue({
          queriedAt: new Date("2026-10-23T16:00:00.000Z"),
          hasMore: false,
          appointments: [{
            _id: new ObjectId(),
            customerId: context.customerId,
            customerName: "Current customer",
            contactPhone: "private contact",
            notes: "private note",
            eventType: "consultation",
            providerId: "doctor",
            status: "scheduled",
            startAt: new Date("2026-10-24T01:30:00.000Z"),
            endAt: new Date("2026-10-24T02:00:00.000Z"),
          }],
        });
      });

      it("pins identity and authorized types while returning safe local appointment details", async () => {
        const execution = await executeUpcomingAppointmentsTool(context, {});

        expect(findUpcomingCustomerAppointments).toHaveBeenCalledWith({
          customerId: context.customerId,
          eventTypes: ["consultation", "follow_up"],
        });
        expect(JSON.parse(execution.output)).toEqual({
          ok: true,
          tool: "calendar.list_appointments",
          timezone: "America/Sao_Paulo",
          queriedAt: "2026-10-23T16:00:00.000Z",
          hasMore: false,
          appointments: [{
            eventType: "consultation",
            eventTypeName: "Consulta",
            resourceName: "Test Doctor",
            status: "scheduled",
            startAt: "2026-10-24T01:30:00.000Z",
            endAt: "2026-10-24T02:00:00.000Z",
            localDate: "2026-10-23",
            localTime: "22:30",
            localEndDate: "2026-10-23",
            localEndTime: "23:00",
            weekdayLabel: "sexta-feira",
          }],
        });
        expect(execution.retryable).toBe(false);
        expect(findSchedulingPlanOptions).not.toHaveBeenCalled();
        expect(holdSchedulingPlanOption).not.toHaveBeenCalled();
        expect(getLatestPaymentRequest).not.toHaveBeenCalled();
        expect(findCustomerById).not.toHaveBeenCalled();
      });

      it.each([
        { customerId: new ObjectId().toHexString() },
        { userId: new ObjectId().toHexString() },
        { appointmentId: new ObjectId().toHexString() },
        { phone: "other customer" },
        { fromDate: "2026-01-01" },
        { eventTypes: ["internal"] },
        { limit: 1000 },
        { unknown: true },
      ])("rejects model-supplied arguments instead of overriding runtime scope: %j", async (args) => {
        const execution = await executeUpcomingAppointmentsTool(context, args);

        expect(JSON.parse(execution.output)).toMatchObject({
          ok: false,
          type: "validation_error",
          errors: [expect.objectContaining({ field: "arguments" })],
        });
        expect(findUpcomingCustomerAppointments).not.toHaveBeenCalled();
      });

      it("fails closed without a runtime customer", async () => {
        // @ts-expect-error Exercise an invalid runtime boundary.
        const execution = await executeUpcomingAppointmentsTool({ ...context, customerId: undefined }, {});

        expect(JSON.parse(execution.output)).toMatchObject({ ok: false, type: "operational_error" });
        expect(findUpcomingCustomerAppointments).not.toHaveBeenCalled();
      });

      it("does not broaden an empty event authorization to every event type", async () => {
        context.configuration.bookableEventTypeKeys = [];
        findUpcomingCustomerAppointments.mockResolvedValue({
          queriedAt: new Date(), hasMore: false, appointments: [],
        });

        const execution = await executeUpcomingAppointmentsTool(context, {});

        expect(findUpcomingCustomerAppointments).toHaveBeenCalledWith({ customerId: context.customerId, eventTypes: [] });
        expect(JSON.parse(execution.output)).toMatchObject({ ok: true, appointments: [], hasMore: false });
      });

      it("reports truncation without treating the result as a full list", async () => {
        findUpcomingCustomerAppointments.mockResolvedValue({
          queriedAt: new Date(), hasMore: true, appointments: [],
        });

        expect(JSON.parse((await executeUpcomingAppointmentsTool(context, {})).output).hasMore).toBe(true);
      });

      it("surfaces database failures rather than reporting an empty list", async () => {
        findUpcomingCustomerAppointments.mockRejectedValue(new Error("Database unavailable"));

        const execution = await executeUpcomingAppointmentsTool(context, {});

        expect(JSON.parse(execution.output)).toMatchObject({
          ok: false, type: "operational_error", error: "Database unavailable",
        });
        expect(execution.retryable).toBe(false);
      });

      it("remains subject to the runtime tool allowlist", async () => {
        context.configuration.enabledTools = [];

        const execution = await executeAgentTool({
          configuration: context.configuration,
          context,
          request: {
            type: "tool_request", reasonCode: "need_authoritative_data",
            toolCall: { tool: "calendar.list_appointments", arguments: {} },
          },
        });

        expect(execution).toMatchObject({ denied: true, mutation: false });
        expect(findUpcomingCustomerAppointments).not.toHaveBeenCalled();
      });

      it("runs as a read without mutation permission or customer confirmation", async () => {
        const isMutationAllowed = vi.fn(async () => false);

        const execution = await executeAgentTool({
          configuration: context.configuration,
          context: { ...context, isMutationAllowed },
          request: {
            type: "tool_request", reasonCode: "need_authoritative_data",
            toolCall: { tool: "calendar.list_appointments", arguments: {} },
          },
        });

        expect(execution).toMatchObject({ denied: false, mutation: false, retryable: false });
        expect(JSON.parse(execution.output).results[0]).toMatchObject({ ok: true });
        expect(isMutationAllowed).not.toHaveBeenCalled();
        expect(holdSchedulingPlanOption).not.toHaveBeenCalled();
      });

      it("does not weaken unique-target identification during rescheduling", async () => {
        findCustomerAppointments.mockResolvedValue({
          appointments: [
            { _id: new ObjectId(), eventType: "consultation" },
            { _id: new ObjectId(), eventType: "consultation" },
          ],
        });

        const execution = await executeRegisteredCalendarTool("find_slots", context, {
          purpose: "reschedule", eventType: "consultation", planKey: null,
          dateIntent: "next_available", fromDate: "2026-10-24", horizonDays: 14,
          period: "any", preferredTime: null, ranking: "earliest", candidateCount: 2, stepCriteria: [],
        });

        expect(JSON.parse(execution!.output)).toMatchObject({
          ok: false,
          type: "validation_error",
          errors: [expect.objectContaining({ field: "currentAppointments" })],
        });
        expect(findCustomerAppointments).toHaveBeenCalledWith(expect.objectContaining({ customerId: context.customerId }));
        expect(findSchedulingPlanOptions).not.toHaveBeenCalled();
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
      candidates: [],
      unavailability: {
        cause: "undetermined",
        scope: "complete_criteria",
      },
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
    getCustomerProfileSnapshot.mockReturnValue({
      missingFields: ["relationshipStatus", "fullName", "birthDate", "cpf", "postalCode", "addressNumber", "profession"],
    });
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
    expect(findCustomerById).not.toHaveBeenCalled();
    expect(getCustomerProfileSnapshot).not.toHaveBeenCalled();
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

  it("does not hold an option after payment confirmation", async () => {
    const optionId = new ObjectId();
    getSchedulingPlanOption.mockResolvedValue({
      _id: optionId,
      customerId,
      planKey: "first_visit",
      configRevision: configuration.revision,
      status: "proposed",
      expiresAt: new Date("2026-09-23T15:00:00.000Z"),
    });
    getLatestPaymentRequest.mockResolvedValue({ status: "paid" });

    const execution = await executeRegisteredCalendarTool("hold", context, {
      candidateId: optionId.toString(),
      confirmedByCustomer: true,
    });
    const result = JSON.parse(execution!.output);

    expect(result).toMatchObject({
      ok: false,
      type: "validation_error",
    });
    expect(result.errors[0]).toMatchObject({ field: "payment" });
    expect(holdSchedulingPlanOption).not.toHaveBeenCalled();
  });
});
