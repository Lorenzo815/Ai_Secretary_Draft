import { describe, expect, it } from "vitest";
import { getWhatsAppServiceWindowStatus } from "./service-window";

describe("WhatsApp customer service window", () => {
  const now = new Date("2026-09-06T18:00:00.000Z");

  it("allows text messages within 24 hours of the latest inbound message", () => {
    const result = getWhatsAppServiceWindowStatus(new Date("2026-09-05T18:00:00.001Z"), now);

    expect(result.canSendText).toBe(true);
    expect(result.expiresAt?.toISOString()).toBe("2026-09-06T18:00:00.001Z");
  });

  it("blocks text messages at the 24-hour boundary", () => {
    const result = getWhatsAppServiceWindowStatus(new Date("2026-09-05T18:00:00.000Z"), now);

    expect(result.canSendText).toBe(false);
    expect(result.reason).toContain("24 horas");
  });

  it("requires an approved template when no inbound message exists", () => {
    const result = getWhatsAppServiceWindowStatus(null, now);

    expect(result.canSendText).toBe(false);
    expect(result.reason).toContain("modelo aprovado");
  });
});