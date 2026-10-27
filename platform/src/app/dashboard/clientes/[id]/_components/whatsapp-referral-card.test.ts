import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WhatsAppReferralCard from "./whatsapp-referral-card";

describe("WhatsApp ad referral card", () => {
  it("renders the ad text and greeting with expandable details, without fetching media", () => {
    const html = renderToStaticMarkup(createElement(WhatsAppReferralCard, { referral: {
      sourceType: "ad", sourceId: "ad-123", sourceUrl: "https://www.instagram.com/p/example/",
      headline: "Projeto verão", body: "Conheça o projeto.", welcomeMessage: "Oi! Como podemos ajudar?",
      imageUrl: "https://cdn.example/ad.jpg", videoUrl: "https://cdn.example/ad.mp4",
    } }));
    expect(html).toContain("Anúncio de origem");
    expect(html).toContain("Projeto verão");
    expect(html).toContain("Conheça o projeto.");
    expect(html).toContain("Saudação do anúncio");
    expect(html).toContain("Oi! Como podemos ajudar?");
    expect(html).toContain("<details");
    expect(html).toContain('href="https://www.instagram.com/p/example/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://cdn.example/ad.jpg"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
  });

  it("does not invent a greeting, platform or ad text when only a reference is provided", () => {
    const html = renderToStaticMarkup(createElement(WhatsAppReferralCard, { referral: { sourceType: "post", sourceId: "post-123" } }));
    expect(html).toContain("Publicação de origem");
    expect(html).toContain("Texto não fornecido pela Meta.");
    expect(html).not.toContain("Saudação do anúncio");
    expect(html).not.toContain("Instagram");
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "invalid-url", "https://user:password@example.com/"])(
    "does not create an unsafe link for %s", (sourceUrl) => {
      const html = renderToStaticMarkup(createElement(WhatsAppReferralCard, { referral: { sourceUrl } }));
      expect(html).not.toContain("href=");
      expect(html).toContain("link indisponível");
    },
  );

  it("escapes untrusted ad copy and greeting", () => {
    const html = renderToStaticMarkup(createElement(WhatsAppReferralCard, { referral: {
      headline: "<script>alert(1)</script>", body: "<img src=x>", welcomeMessage: "<b>hello</b>",
    } }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;hello&lt;/b&gt;");
  });
});
