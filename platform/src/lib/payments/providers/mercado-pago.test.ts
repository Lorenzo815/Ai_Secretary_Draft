import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyMercadoPagoWebhookSignature } from "./mercado-pago-signature";

describe("Mercado Pago webhook signature", () => {
  it("accepts the documented HMAC manifest and rejects tampering", () => {
    const secret = "webhook-test-secret";
    const manifest = "id:12345;request-id:req-abc;ts:1720000000;";
    const digest = createHmac("sha256", secret).update(manifest).digest("hex");
    expect(verifyMercadoPagoWebhookSignature({
      signature: `ts=1720000000,v1=${digest}`,
      requestId: "req-abc",
      dataId: "12345",
      secret,
    })).toBe(true);
    expect(verifyMercadoPagoWebhookSignature({
      signature: `ts=1720000000,v1=${digest}`,
      requestId: "req-tampered",
      dataId: "12345",
      secret,
    })).toBe(false);
  });
});