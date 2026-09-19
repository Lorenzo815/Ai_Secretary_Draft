import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOperationalEmbeddedSignupConfig = vi.hoisted(() => vi.fn());
vi.mock("./embedded-signup", () => ({ getOperationalEmbeddedSignupConfig }));

import { isValidWebhookSignature, sendWhatsAppTemplate } from "./client";

describe("WhatsApp template delivery client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getOperationalEmbeddedSignupConfig.mockResolvedValue({
      accessToken: "secret-token",
      phoneNumberId: "9988776655",
      businessAccountId: "1122334455",
      graphVersion: "v25.0",
    });
  });

  describe("WhatsApp webhook signature validation", () => {
    const originalAppSecret = process.env.WHATSAPP_APP_SECRET;

    afterEach(() => {
      if (originalAppSecret === undefined) {
        delete process.env.WHATSAPP_APP_SECRET;
      } else {
        process.env.WHATSAPP_APP_SECRET = originalAppSecret;
      }
    });

    it("fails closed when the app secret is not configured", () => {
      delete process.env.WHATSAPP_APP_SECRET;

      expect(isValidWebhookSignature("{}", null)).toBe(false);
      expect(isValidWebhookSignature("{}", "sha256=forged")).toBe(false);
    });

    it("accepts only the matching HMAC signature", () => {
      process.env.WHATSAPP_APP_SECRET = "test-app-secret";
      const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
      const signature = `sha256=${createHmac("sha256", "test-app-secret").update(rawBody).digest("hex")}`;

      expect(isValidWebhookSignature(rawBody, signature)).toBe(true);
      expect(isValidWebhookSignature(`${rawBody} `, signature)).toBe(false);
      expect(isValidWebhookSignature(rawBody, "sha256=forged")).toBe(false);
      expect(isValidWebhookSignature(rawBody, null)).toBe(false);
    });
  });

  it("sends text and dynamic URL parameters using the Cloud API template format", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.template" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppTemplate({
      to: "+55 (11) 98888-7777",
      name: "confirmar_agendamento",
      language: "pt_BR",
      headerParameters: ["Maria"],
      bodyParameters: ["Maria", "10/09/2026"],
      buttonUrlParameters: [{ index: 0, value: "consulta-123" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v25.0/9988776655/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
      }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511988887777",
      type: "template",
      template: {
        name: "confirmar_agendamento",
        language: { code: "pt_BR" },
        components: [
          { type: "header", parameters: [{ type: "text", text: "Maria" }] },
          { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "10/09/2026" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "consulta-123" }] },
        ],
      },
    });
  });
});