import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ process: vi.fn(), after: vi.fn(), enqueue: vi.fn() }));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(), after: mocks.after,
}));
vi.mock("@/lib/whatsapp", () => ({
  processWhatsAppWebhook: mocks.process,
  WhatsAppWebhookError: class extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
}));
vi.mock("@/lib/whatsapp/forwarding", () => ({ enqueueWhatsAppForwarding: mocks.enqueue }));

import { WhatsAppWebhookError } from "@/lib/whatsapp";
import { POST } from "./route";

const integrationToken = "test-integration-token-with-independent-secret";
const raw = '{\n "object": "whatsapp_business_account", "entry": [], "extra": "Olá 😀"\n}';
const result = { receivedMessages: 1, statusUpdates: 0, coexistenceEvents: 0, processingRequests: 0 };
const fetchMock = vi.fn<typeof fetch>();

function request(authorization: string | null = `Bearer ${integrationToken}`, body = raw, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({ "Content-Type": "application/json", ...extraHeaders });
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest("https://oria.example/api/webhooks/whatsapp/integration", {
    method: "POST", body, headers,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WHATSAPP_INTEGRATION_WEBHOOK_TOKEN", integrationToken);
  vi.stubEnv("WHATSAPP_APP_SECRET", "");
  vi.stubEnv("ASSISTANT_WORKER_SECRET", "test-worker-secret");
  mocks.process.mockResolvedValue(result);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Bearer-authenticated WhatsApp integration webhook", () => {
  it("fails closed without its dedicated token", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_WEBHOOK_TOKEN", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it.each([
    null,
    "",
    "Bearer ",
    "Basic test-integration-token-with-independent-secret",
    "Bearer wrong",
    `Bearer ${"x".repeat(integrationToken.length)}`,
  ])("rejects missing, malformed or incorrect authorization: %s", async authorization => {
    const response = await POST(request(authorization));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autorizado." });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not accept a Meta signature instead of the integration token", async () => {
    const response = await POST(request(null, raw, { "x-hub-signature-256": "sha256=signed" }));
    expect(response.status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("accepts its Bearer token without a Meta app secret or signature and preserves the payload", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ...result });
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith(raw);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["JSON inválido.", "Evento não suportado."])("preserves payload validation errors: %s", async message => {
    mocks.process.mockRejectedValue(new WhatsAppWebhookError(message, 400));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("does not hide unexpected processing failures behind a successful acknowledgement", async () => {
    mocks.process.mockRejectedValue(new Error("storage unavailable"));
    await expect(POST(request())).rejects.toThrow("storage unavailable");
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("triggers the existing assistant worker after acknowledgement when processing was requested", async () => {
    mocks.process.mockResolvedValue({ ...result, processingRequests: 2 });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    expect((await POST(request())).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://oria.example/api/internal/assistant/process"),
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer test-worker-secret" } }),
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("logs an unavailable assistant worker secret without leaking the integration token", async () => {
    vi.stubEnv("ASSISTANT_WORKER_SECRET", "");
    mocks.process.mockResolvedValue({ ...result, processingRequests: 1 });
    expect((await POST(request())).status).toBe(200);
    await mocks.after.mock.calls[0][0]();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ASSISTANT_WORKER_SECRET"));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(integrationToken);
  });

  it("logs a failed assistant trigger instead of silently ignoring it", async () => {
    mocks.process.mockResolvedValue({ ...result, processingRequests: 1 });
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await POST(request())).status).toBe(200);
    await mocks.after.mock.calls[0][0]();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 503"));
  });
});
