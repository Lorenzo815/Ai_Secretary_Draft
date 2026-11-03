import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentConfiguration } from "../agent/defaults";
import type { ToolExecutionContext } from "./contracts";

const mocks = vi.hoisted(() => ({
  createPaymentRequest: vi.fn(),
  createMercadoPagoPaymentRequest: vi.fn(),
  getPaymentProviderConfiguration: vi.fn(),
  extendHeldSchedulingPlanOptions: vi.fn(),
}));

vi.mock("../../payments", async () => {
  const { enabledPaymentMethods } = await import("../../payments/payment-methods");
  return {
    enabledPaymentMethods,
    MERCADO_PAGO_WEBHOOK_PATH: "/api/webhooks/mercado-pago",
    createPaymentRequest: mocks.createPaymentRequest,
    createMercadoPagoPaymentRequest: mocks.createMercadoPagoPaymentRequest,
    getPaymentProviderConfiguration: mocks.getPaymentProviderConfiguration,
  };
});
vi.mock("../../calendar/plans", () => ({ extendHeldSchedulingPlanOptions: mocks.extendHeldSchedulingPlanOptions }));

import { executePaymentRequestTool } from "./payment";

const mercadoPagoSettings = {
  pixInChat: true, paymentLink: false, linkMethods: ["credit_card"], maxInstallments: 1, pixExpiryMinutes: 60, linkExpiryHours: 24,
};

function provider(overrides: Record<string, unknown> = {}, methods: Record<string, unknown> = {}) {
  return { activeProvider: "mercado_pago", humanFallbackEnabled: true, mercadoPago: { ...mercadoPagoSettings, ...methods }, ...overrides };
}

describe("payment.request_deposit", () => {
  let context: ToolExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_URL", "https://oria.test");
    const configuration = createDefaultAgentConfiguration();
    configuration.payment = { pixKey: "manual-key", recipientName: "Clinic", signalAmountCents: 12_345 };
    context = { customerId: new ObjectId(), customerName: "Customer", contactPhone: "", configuration };
    const payment = { _id: new ObjectId(), amountCents: 12_345, status: "awaiting_human_confirmation" };
    mocks.createPaymentRequest.mockResolvedValue({ ...payment, provider: "manual", pixKeySnapshot: "manual-key", recipientNameSnapshot: "Clinic" });
    mocks.createMercadoPagoPaymentRequest.mockImplementation(async (input: { channel: string }) => ({
      ...payment, status: "awaiting_provider_confirmation", provider: "mercado_pago", channel: input.channel,
      expiresAt: new Date("2026-11-03T12:00:00Z"),
    }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured amount for manual Pix, without expiry or hold extension", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider({ activeProvider: "manual" }));

    const result = JSON.parse((await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: null, method: null })).output);

    expect(mocks.createPaymentRequest).toHaveBeenCalledWith({
      customerId: context.customerId, amountCents: 12_345, pixKey: "manual-key", recipientName: "Clinic",
    });
    expect(result).toMatchObject({ ok: true, amountCents: 12_345, channel: "manual_pix", pixKey: "manual-key" });
    expect(mocks.createMercadoPagoPaymentRequest).not.toHaveBeenCalled();
    expect(mocks.extendHeldSchedulingPlanOptions).not.toHaveBeenCalled();
  });

  it("uses the only enabled Mercado Pago method and the clinic's notification URL", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider());

    await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: null });

    expect(mocks.createMercadoPagoPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({
      customerId: context.customerId, amountCents: 12_345, payerEmail: "customer@example.com", payerName: "Customer",
      channel: "pix", notificationUrl: "https://oria.test/api/webhooks/mercado-pago",
    }));
  });

  it("asks which method when the clinic accepts more than one", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider({}, { paymentLink: true }));

    const result = await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: null });

    expect(result.retryable).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({ ok: false, errors: [{ field: "method", code: "method_required" }] });
    expect(mocks.createMercadoPagoPaymentRequest).not.toHaveBeenCalled();
  });

  it("refuses a method the clinic didn't enable", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider());

    const result = await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: "payment_link" });

    expect(JSON.parse(result.output)).toMatchObject({ ok: false, errors: [{ code: "method_not_enabled" }] });
  });

  it("creates a payment link and keeps the slot held until the link expires, plus boleto clearing time", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider({}, { pixInChat: false, paymentLink: true, linkMethods: ["credit_card", "ticket"], maxInstallments: 3 }));

    const result = JSON.parse((await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: "payment_link" })).output);

    expect(result).toMatchObject({ ok: true, channel: "payment_link", linkMethods: ["credit_card", "ticket"], maxInstallments: 3 });
    expect(mocks.extendHeldSchedulingPlanOptions).toHaveBeenCalledWith(context.customerId, new Date("2026-11-06T12:00:00Z"));
  });

  it("keeps a Pix slot held until the code expires", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider());

    await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: "pix" });

    expect(mocks.extendHeldSchedulingPlanOptions).toHaveBeenCalledWith(context.customerId, new Date("2026-11-03T12:00:00Z"));
  });

  it("falls back to manual Pix (human confirmation) when Mercado Pago fails", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider());
    mocks.createMercadoPagoPaymentRequest.mockRejectedValue(new Error("Provider unavailable"));

    const result = JSON.parse((await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: "pix" })).output);

    expect(mocks.createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 12_345 }));
    expect(result).toMatchObject({ ok: true, amountCents: 12_345, provider: "manual", channel: "manual_pix" });
  });

  it("reports the failure when Mercado Pago fails and fallback is off", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue(provider({ humanFallbackEnabled: false }));
    mocks.createMercadoPagoPaymentRequest.mockRejectedValue(new Error("Provider unavailable"));

    const result = JSON.parse((await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com", method: "pix" })).output);

    expect(result).toMatchObject({ ok: false, type: "operational_error", message: "Provider unavailable" });
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });
});
