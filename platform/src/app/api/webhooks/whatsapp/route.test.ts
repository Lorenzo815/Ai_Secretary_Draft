import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ valid: vi.fn(), process: vi.fn(), enqueue: vi.fn(), forward: vi.fn(), after: vi.fn() }));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(), after: mocks.after,
}));
vi.mock("@/lib/whatsapp", () => ({
  isValidWebhookSignature: mocks.valid, processWhatsAppWebhook: mocks.process,
  WhatsAppWebhookError: class extends Error {},
}));
vi.mock("@/lib/mongodb", () => ({ default: {} }));
vi.mock("@/lib/whatsapp/forwarding", () => ({
  enqueueWhatsAppForwarding: mocks.enqueue, processForwardingDeliveries: mocks.forward,
  ForwardingRoutingError: class extends Error {},
}));
import { GET, POST } from "./route";

const raw = '{\n "object": "whatsapp_business_account", "entry": [], "extra": "Olá 😀"\n}';
function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://oria.example/api/webhooks/whatsapp", {
    method: "POST", body: raw, headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=signed", ...headers },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("WHATSAPP_APP_SECRET", "test-secret");
  vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "test-verification");
  mocks.valid.mockReturnValue(true);
  mocks.enqueue.mockResolvedValue(1);
  mocks.process.mockResolvedValue({ processingRequests: 0, receivedMessages: 1 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Meta webhook forwarding integration", () => {
  it("preserves GET verification and never forwards its verification token", async () => {
    const response = await GET(new NextRequest("https://oria.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verification&hub.challenge=challenge"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures before persistence, processing or outbound delivery", async () => {
    mocks.valid.mockReturnValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not allow an integration Bearer token to replace Meta signature validation", async () => {
    vi.stubEnv("WHATSAPP_INTEGRATION_WEBHOOK_TOKEN", "integration-token");
    mocks.valid.mockReturnValue(false);
    expect((await POST(request({ authorization: "Bearer integration-token" }))).status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("rejects missing signatures even when the signature verifier is not called", async () => {
    expect((await POST(request({ "x-hub-signature-256": "" }))).status).toBe(401);
    expect(mocks.valid).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("fails closed when the Meta app secret is missing", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.valid).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("persists exact bytes before internal processing and schedules outbound work after acknowledgement", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(new Uint8Array(Buffer.from(raw)), "sha256=signed");
    expect(mocks.valid).toHaveBeenCalledWith(new Uint8Array(Buffer.from(raw)), "sha256=signed");
    expect(mocks.enqueue.mock.invocationCallOrder[0]).toBeLessThan(mocks.process.mock.invocationCallOrder[0]);
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith(raw);
    expect(mocks.forward).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.forward).toHaveBeenCalledOnce();
  });
  it("does not acknowledge an event whose durable outbox failed", async () => {
    mocks.enqueue.mockRejectedValue(new Error("private storage details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private storage details");
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("preserves the old processing path when no destinations are active", async () => {
    mocks.enqueue.mockResolvedValue(0);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith(raw);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects forwarded loops before enqueueing them again", async () => {
    expect((await POST(request({ "x-oria-webhook-forwarded": "1" }))).status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
