import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerDocument } from "../../crm";
import { createDefaultAgentConfiguration } from "./defaults";

const mocks = vi.hoisted(() => ({
  getActiveSchedulingPlanOption: vi.fn(),
  getCalendarSettings: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
  getLatestPaymentRequest: vi.fn(),
  getPaymentProviderConfiguration: vi.fn(),
  findUnallocatedPaidPayment: vi.fn(),
  hasPaidDepositBefore: vi.fn(),
}));

vi.mock("../../calendar", () => ({
  getActiveSchedulingPlanOption: mocks.getActiveSchedulingPlanOption,
  getCalendarSettings: mocks.getCalendarSettings,
}));
vi.mock("../../payments", async () => {
  const { enabledPaymentMethods } = await import("../../payments/payment-methods");
  const planPayment = await import("../../payments/plan-payment");
  return {
    enabledPaymentMethods,
    withoutPaymentConditions: planPayment.withoutPaymentConditions,
    findUnallocatedPaidPayment: mocks.findUnallocatedPaidPayment,
    depositForPlan: async (_customerId: unknown, plan: Parameters<typeof planPayment.resolvePlanPayment>[0], legacyAmountCents: number) => {
      const payment = planPayment.resolvePlanPayment(plan, legacyAmountCents);
      return { ...payment, required: planPayment.depositRequired(payment, { hasPaidDepositBefore: await mocks.hasPaidDepositBefore() }) };
    },
    getLatestPaymentRequest: mocks.getLatestPaymentRequest,
    getPaymentProviderConfiguration: mocks.getPaymentProviderConfiguration,
  };
});
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
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "manual" });
    mocks.getCustomerProfileSnapshot.mockReturnValue({ missingFields: [] });
    mocks.findUnallocatedPaidPayment.mockResolvedValue(null);
    mocks.hasPaidDepositBefore.mockResolvedValue(false);
  });

  it.each(["manual", "mercado_pago"] as const)("exposes authorized events and the live %s payment mode without provider secrets", async (provider) => {
    const configuration = createDefaultAgentConfiguration();
    configuration.bookableEventTypeKeys = ["doctor_consultation"];
    mocks.getPaymentProviderConfiguration.mockResolvedValue({
      activeProvider: provider,
      humanFallbackEnabled: true,
      mercadoPago: { pixInChat: true, paymentLink: true, linkMethods: ["credit_card", "ticket"], maxInstallments: 3, pixExpiryMinutes: 60, linkExpiryHours: 24 },
      updatedBy: "server-only-metadata",
    });
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
    expect(runtime.operations).toEqual({
      serviceStatus: "ai_active",
      paymentStatus: null,
      paymentProvider: provider,
      paymentMethods: provider === "mercado_pago" ? ["pix", "payment_link"] : ["pix"],
      paymentLinkMethods: ["credit_card", "ticket"],
      maxInstallments: 3,
      unallocatedPaidDeposit: null,
      activeSchedulingOption: null,
    });
    expect(JSON.stringify(runtime)).not.toContain("server-only-metadata");
  });

  it("tells the model each plan's deposit rule and whether this patient owes it now", async () => {
    const configuration = createDefaultAgentConfiguration();
    configuration.bookableEventTypeKeys = ["doctor_consultation", "bioimpedance"];
    const legacy = { ...configuration.schedulingPlans[0], key: "legacy", payment: undefined,
      prerequisites: { all: [{ field: "operations.paymentStatus", operator: "eq" as const, value: "paid" }] } };
    configuration.schedulingPlans = [
      { ...configuration.schedulingPlans[0], payment: { requirement: "first_time", amountCents: 20_000 } },
      legacy,
    ];
    configuration.payment.signalAmountCents = 15_000;
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "manual", mercadoPago: { linkMethods: [], maxInstallments: 1 } });
    mocks.getActiveSchedulingPlanOption.mockResolvedValue(null);
    mocks.hasPaidDepositBefore.mockResolvedValue(true);
    mocks.findUnallocatedPaidPayment.mockResolvedValue({ _id: new ObjectId(), amountCents: 20_000 });
    const now = new Date();

    const runtime = await buildAgentRuntimeContext({
      customer: { _id: new ObjectId(), phones: [], identifiers: [], name: "Cliente", firstInteractionAt: now, lastInteractionAt: now, createdAt: now, updatedAt: now },
      configuration, trigger: "inbound_message", iteration: 1,
    });

    expect(runtime.clinic.schedulingPlans.map((plan) => ({ key: plan.key, deposit: plan.deposit, prerequisites: plan.prerequisites }))).toEqual([
      { key: "first_visit", deposit: { requirement: "first_time", amountCents: 20_000, requiredNow: false }, prerequisites: configuration.schedulingPlans[0].prerequisites },
      { key: "legacy", deposit: { requirement: "always", amountCents: 15_000, requiredNow: true }, prerequisites: {} },
    ]);
    expect(runtime.operations.unallocatedPaidDeposit).toEqual({ amountCents: 20_000 });
  });
});
