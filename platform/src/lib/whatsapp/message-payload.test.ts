import { describe, expect, it } from "vitest";
import { getMessageBody, getMessageReferral, type WebhookMessage } from "./message-payload";

describe("WhatsApp ad referral normalization", () => {
  it("preserves the ad copy, actual welcome text, media links and attribution separately from the customer text", () => {
    const message: WebhookMessage = {
      type: "text", text: { body: "Oi quero saber mais sobre o projeto verão" },
      referral: {
        source_type: "ad", source_id: "ad-123", source_url: "https://www.instagram.com/p/example/",
        headline: "Projeto verão", body: "Conheça o projeto.",
        welcome_message: { text: "Oi! Como podemos ajudar?" },
        media_type: "video", image_url: "https://cdn.example/ad.jpg",
        video_url: "https://cdn.example/ad.mp4", thumbnail_url: "https://cdn.example/thumb.jpg",
        ctwa_clid: "click-123", ref: "sequence-ref",
      },
    };
    expect(getMessageReferral(message)).toEqual({
      sourceType: "ad", sourceId: "ad-123", sourceUrl: "https://www.instagram.com/p/example/",
      headline: "Projeto verão", body: "Conheça o projeto.", welcomeMessage: "Oi! Como podemos ajudar?",
      mediaType: "video", imageUrl: "https://cdn.example/ad.jpg",
      videoUrl: "https://cdn.example/ad.mp4", thumbnailUrl: "https://cdn.example/thumb.jpg",
      ctwaClid: "click-123", ref: "sequence-ref",
    });
    expect(getMessageBody(message)).toBe("Oi quero saber mais sobre o projeto verão");
  });

  it("does not invent a greeting, click ID, platform or missing ad text", () => {
    expect(getMessageReferral({ referral: { source_type: "ad", source_id: "status-ad" } }))
      .toEqual({ sourceType: "ad", sourceId: "status-ad" });
    expect(getMessageReferral({ referral: { source_type: "post", welcome_message: {} } }))
      .toEqual({ sourceType: "post" });
    expect(getMessageReferral({ referral: {} })).toEqual({});
    expect(getMessageReferral({ type: "text", text: { body: "Oi" } })).toBeNull();
  });

  it("retains actual text literally rather than treating it as markup or placeholders", () => {
    const text = '<script>alert(1)</script> {{1}} $&\nlinha 2';
    expect(getMessageReferral({ referral: { body: text, welcome_message: { text } } }))
      .toEqual({ body: text, welcomeMessage: text });
  });

  it.each([
    null, "ad", [], { source_id: 123 }, { body: {} },
    { welcome_message: "Oi" }, { welcome_message: [] }, { welcome_message: { text: 123 } },
  ])("rejects malformed metadata explicitly: %j", (referral) => {
    const message: WebhookMessage = JSON.parse(JSON.stringify({ referral }));
    expect(() => getMessageReferral(message)).toThrow("WHATSAPP_REFERRAL_INVALID_PAYLOAD");
  });
});
