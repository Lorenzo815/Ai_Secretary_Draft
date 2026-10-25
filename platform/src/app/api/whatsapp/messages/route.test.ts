import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), catalog: vi.fn(), sample: vi.fn(), text: vi.fn(), save: vi.fn(), indexes: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/whatsapp", () => ({
  listWhatsAppTemplates: mocks.catalog, sendSampleTemplate: mocks.sample, sendTextMessage: mocks.text,
  saveWhatsAppMessage: mocks.save, ensureWhatsAppMessageIndexes: mocks.indexes, listWhatsAppMessages: vi.fn(),
  SAMPLE_TEMPLATE_NAME: "jaspers_market_order_confirmation_v1", SAMPLE_TEMPLATE_LANGUAGE: "en_US",
}));
vi.mock("@/lib/whatsapp/templates", () => ({ getCachedWhatsAppTemplates: vi.fn() }));
import { POST } from "./route";

const template = {
  id: "123", name: "jaspers_market_order_confirmation_v1", language: "en_US", status: "APPROVED", category: "UTILITY",
  components: [
    { type: "BODY", text: "Hello {{1}}, order {{2}} is scheduled for {{3}}." },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirm" }] },
  ],
};
function request() {
  return new NextRequest("https://oria.example/api/whatsapp/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "5511999999999", customerName: "Maria", orderNumber: "123", orderDate: "26/10" }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { email: "admin@example.com" } });
  mocks.catalog.mockResolvedValue([template]);
  mocks.sample.mockResolvedValue({ messageId: "wamid.sample", to: "5511999999999" });
});
describe("legacy sample template context", () => {
  it("stores the actual catalog text, supplied values and available buttons", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      metaMessageId: "wamid.sample", type: "template", templateName: template.name, templateLanguage: "en_US",
      body: "Hello Maria, order 123 is scheduled for 26/10.\n\nOpções: Confirm",
    }));
  });
  it("does not send when the template is unavailable in the company catalog", async () => {
    mocks.catalog.mockResolvedValue([]);
    expect((await POST(request())).status).toBe(502);
    expect(mocks.sample).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not send if the real parameters cannot render the approved definition", async () => {
    mocks.catalog.mockResolvedValue([{ ...template, components: [{ type: "BODY", text: "Missing {{4}}" }] }]);
    expect((await POST(request())).status).toBe(502);
    expect(mocks.sample).not.toHaveBeenCalled();
  });
  it("keeps authentication ahead of catalog access", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.sample).not.toHaveBeenCalled();
  });
});
