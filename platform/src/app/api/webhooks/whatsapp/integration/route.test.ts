import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/whatsapp/integration-templates", () => ({
  sendIntegrationTemplate: mocks.send,
  IntegrationWhatsAppTemplateError: class extends Error {
    constructor(message: string, readonly code: string, readonly status: number) { super(message); }
  },
}));
vi.mock("@/lib/whatsapp/template-messages", () => ({
  WhatsAppTemplatePersistenceError: class extends Error {
    constructor(readonly messageId: string) { super("Envio aceito; histórico não salvo. Não repita automaticamente."); }
  },
}));

import { IntegrationWhatsAppTemplateError } from "@/lib/whatsapp/integration-templates";
import { WhatsAppTemplatePersistenceError } from "@/lib/whatsapp/template-messages";
import { POST } from "./route";

const token = "test-integration-token-with-independent-secret";
const payload = {
  messaging_product: "whatsapp", to: "5542988076200", type: "template",
  template: {
    name: "lead_contato", language: { code: "pt_BR" },
    components: [{ type: "body", parameters: [{ type: "text", text: "mais informações da consulta" }] }],
  },
};

function request(authorization: string | null = `Bearer ${token}`, body = JSON.stringify(payload), contentType = "application/json") {
  const headers = new Headers({ "content-type": contentType });
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest("https://oria.example/api/webhooks/whatsapp/integration", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("WHATSAPP_INTEGRATION_WEBHOOK_TOKEN", token);
  vi.stubEnv("WHATSAPP_APP_SECRET", "");
  mocks.send.mockResolvedValue({
    messageId: "wamid.sent-template", contactPhone: payload.to, body: "Texto renderizado",
    templateName: "lead_contato", templateLanguage: "pt_BR", status: "sent",
    timestamp: new Date("2026-10-28T15:00:00Z"),
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Bearer-authenticated integration template sending", () => {
  it("fails closed without its dedicated token", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_WEBHOOK_TOKEN", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it.each([null, "", "Bearer ", "Basic invalid", "Bearer wrong", `Bearer ${"x".repeat(token.length)}`])(
    "rejects invalid authorization before reading or sending: %s", async authorization => {
      const response = await POST(request(authorization, "invalid json"));
      expect(response.status).toBe(401);
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("does not accept a Meta signature instead of a Bearer token", async () => {
    const input = request(null);
    input.headers.set("x-hub-signature-256", "sha256=signed");
    expect((await POST(input)).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("requires JSON content type", async () => {
    expect((await POST(request(undefined, undefined, "text/plain"))).status).toBe(415);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON without sending", async () => {
    const response = await POST(request(undefined, "{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "JSON inválido." });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("accepts the exact provider payload without WABA, wamid, timestamp or Meta signature", async () => {
    const response = await POST(request(undefined, undefined, "application/json; charset=utf-8"));
    expect(response.status).toBe(201);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(payload);
    expect(await response.json()).toEqual({
      messaging_product: "whatsapp", messages: [{ id: "wamid.sent-template" }], historySaved: true,
      message: {
        messageId: "wamid.sent-template", contactPhone: payload.to, body: "Texto renderizado",
        templateName: "lead_contato", templateLanguage: "pt_BR", status: "sent",
        timestamp: "2026-10-28T15:00:00.000Z", type: "template", direction: "outbound",
      },
    });
  });

  it.each([400, 409, 502])("preserves explicit template failure status %s", async status => {
    mocks.send.mockRejectedValue(new IntegrationWhatsAppTemplateError("Falha de envio", "TEMPLATE_ERROR", status));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Falha de envio", code: "TEMPLATE_ERROR" });
  });

  it("reports the real wamid if sending succeeded but history persistence failed", async () => {
    mocks.send.mockRejectedValue(new WhatsAppTemplatePersistenceError("wamid.accepted", new Error("storage")));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "TEMPLATE_HISTORY_SAVE_FAILED", messageId: "wamid.accepted",
      acceptedByMeta: true, historySaved: false,
    });
  });

  it("logs unexpected failures without leaking private details or acknowledging success", async () => {
    mocks.send.mockRejectedValue(new Error("private connection details"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private connection details");
    expect(console.error).toHaveBeenCalled();
  });
});
