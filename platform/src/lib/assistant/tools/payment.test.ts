import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentConfiguration } from "../agent/defaults";
import type { ToolExecutionContext } from "./contracts";

const mocks = vi.hoisted(() => ({
  createPaymentRequest: vi.fn(),
  createMercadoPagoPaymentRequest: vi.fn(),
  getPaymentProviderConfiguration: vi.fn(),
}));

vi.mock("../../payments", () => mocks);

import { executePaymentRequestTool } from "./payment";

describe("shared deposit amount across payment modes", () => {
  let context: ToolExecutionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    const configuration = createDefaultAgentConfiguration();
    configuration.payment = { pixKey: "manual-key", recipientName: "Clinic", signalAmountCents: 12_345 };
    context = { customerId: new ObjectId(), customerName: "Customer", contactPhone: "", configuration };
    const payment = { _id: new ObjectId(), amountCents: 12_345, status: "awaiting_human_confirmation" };
    mocks.createPaymentRequest.mockResolvedValue({ ...payment, provider: "manual" });
    mocks.createMercadoPagoPaymentRequest.mockResolvedValue({ ...payment, provider: "mercado_pago" });
  });

  it("uses the configured amount for manual Pix", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "manual", humanFallbackEnabled: true });

    const result = await executePaymentRequestTool(context, { confirmedByCustomer: true });

    expect(mocks.createPaymentRequest).toHaveBeenCalledWith({
      customerId: context.customerId, amountCents: 12_345, pixKey: "manual-key", recipientName: "Clinic",
    });
    expect(JSON.parse(result.output).amountCents).toBe(12_345);
    expect(mocks.createMercadoPagoPaymentRequest).not.toHaveBeenCalled();
  });

  it("uses the same configured amount for Mercado Pago", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "mercado_pago", humanFallbackEnabled: true });

    const result = await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com" });

    expect(mocks.createMercadoPagoPaymentRequest).toHaveBeenCalledWith({
      customerId: context.customerId, amountCents: 12_345, payerEmail: "customer@example.com",
    });
    expect(JSON.parse(result.output).amountCents).toBe(12_345);
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });

  it("preserves the amount when falling back to manual Pix", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "mercado_pago", humanFallbackEnabled: true });
    mocks.createMercadoPagoPaymentRequest.mockRejectedValue(new Error("Provider unavailable"));

    const result = await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com" });

    expect(mocks.createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 12_345 }));
    expect(JSON.parse(result.output)).toMatchObject({ ok: true, amountCents: 12_345, provider: "manual" });
  });

  it("does not fall back when human fallback is disabled", async () => {
    mocks.getPaymentProviderConfiguration.mockResolvedValue({ activeProvider: "mercado_pago", humanFallbackEnabled: false });
    mocks.createMercadoPagoPaymentRequest.mockRejectedValue(new Error("Provider unavailable"));

    const result = await executePaymentRequestTool(context, { confirmedByCustomer: true, payerEmail: "customer@example.com" });

    expect(JSON.parse(result.output)).toMatchObject({ ok: false, type: "operational_error" });
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });
});
