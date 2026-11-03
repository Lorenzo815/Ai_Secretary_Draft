import { describe, expect, it } from "vitest";
import { DEFAULT_MERCADO_PAGO_SETTINGS, enabledPaymentMethods, validateMercadoPagoSettings } from "./payment-methods";

describe("payment methods configuration", () => {
  it("keeps the current settings when nothing is sent, and starts new clinics with Pix in the chat", () => {
    expect(validateMercadoPagoSettings(undefined)).toEqual(DEFAULT_MERCADO_PAGO_SETTINGS);
    expect(DEFAULT_MERCADO_PAGO_SETTINGS).toMatchObject({ pixInChat: true, paymentLink: false });
  });

  it("accepts a complete configuration and orders the link methods", () => {
    expect(validateMercadoPagoSettings({
      pixInChat: false, paymentLink: true, linkMethods: ["ticket", "credit_card"], maxInstallments: 6, pixExpiryMinutes: 30, linkExpiryHours: 48,
    })).toEqual({
      pixInChat: false, paymentLink: true, linkMethods: ["credit_card", "ticket"], maxInstallments: 6, pixExpiryMinutes: 30, linkExpiryHours: 48,
    });
  });

  it.each([
    [{ pixInChat: false, paymentLink: false }, "ao menos um meio"],
    [{ paymentLink: true, linkMethods: [] }, "ao menos um meio para o link"],
    [{ linkMethods: ["crypto"] }, "Meios do link"],
    [{ maxInstallments: 13 }, "1 a 12"],
    [{ pixExpiryMinutes: 7 }, "Validade do Pix"],
    [{ linkExpiryHours: 1000 }, "Validade do link"],
  ])("rejects %j", (input, message) => {
    expect(() => validateMercadoPagoSettings(input)).toThrow(message);
  });

  it("offers only what the clinic enabled for its active provider", () => {
    const mercadoPago = { ...DEFAULT_MERCADO_PAGO_SETTINGS, paymentLink: true };
    expect(enabledPaymentMethods({ activeProvider: "manual", mercadoPago })).toEqual(["pix"]);
    expect(enabledPaymentMethods({ activeProvider: "mercado_pago", mercadoPago })).toEqual(["pix", "payment_link"]);
    expect(enabledPaymentMethods({ activeProvider: "mercado_pago", mercadoPago: { ...mercadoPago, pixInChat: false } })).toEqual(["payment_link"]);
  });
});
