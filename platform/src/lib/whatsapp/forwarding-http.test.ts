import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), end: vi.fn(), destroy: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { forwardingUrl, isPublicForwardingAddress, sendForwardedWebhook } from "./forwarding-http";

const input = {
  url: "https://receiver.example/webhook?source=oria",
  body: new Uint8Array(Buffer.from('{\n "object": "whatsapp_business_account", "text": "Olá 😀" }\n')),
  deliveryId: "delivery-id",
  signature: `sha256=${"a".repeat(64)}`,
  isTest: false,
};
let status: number;

beforeEach(() => {
  vi.clearAllMocks();
  status = 200;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("NEXTAUTH_URL", "https://oria.example");
  vi.stubEnv("VERCEL_URL", undefined);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.request.mockImplementation((_options: RequestOptions, callback: (response: object) => void) => {
    const outgoing = new EventEmitter();
    return Object.assign(outgoing, {
      end: (body: Uint8Array) => {
        mocks.end(body);
        queueMicrotask(() => callback({ statusCode: status, destroy: mocks.destroy }));
      },
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("safe exact-body webhook transport", () => {
  it("pins validated DNS while preserving body bytes, Host, TLS identity and Meta signature", async () => {
    expect(await sendForwardedWebhook(input)).toMatchObject({ ok: true, status: 200, error: null });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith("receiver.example", { all: true, verbatim: true });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "93.184.216.34", servername: "receiver.example", port: 443,
      path: "/webhook?source=oria", method: "POST",
      headers: expect.objectContaining({
        Host: "receiver.example", "Content-Type": "application/json",
        "Content-Length": input.body.byteLength, "X-Hub-Signature-256": input.signature,
        "X-Oria-Delivery-Id": input.deliveryId, "X-Oria-Webhook-Forwarded": "1",
      }),
    }), expect.any(Function));
    expect(Buffer.from(mocks.end.mock.calls[0][0])).toEqual(Buffer.from(input.body));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it.each([201, 204, 301, 302, 400, 429, 500, 503])("reports HTTP %s as failure and never follows redirects", async code => {
    status = code;
    expect(await sendForwardedWebhook(input)).toMatchObject({ ok: false, status: code, error: expect.stringContaining(`HTTP ${code}`) });
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it.each([
    "0.0.0.0", "10.1.1.1", "127.0.0.1", "100.100.100.200", "169.254.169.254",
    "172.16.1.1", "192.168.1.1", "192.0.2.1", "198.18.1.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::",
  ])("rejects non-public IP %s", address => {
    expect(isPublicForwardingAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("allows public IP %s", address => {
    expect(isPublicForwardingAddress(address)).toBe(true);
  });

  it.each([
    "http://receiver.example", "https://localhost/path", "https://test.local/path",
    "https://127.0.0.1", "https://2130706433", "https://0x7f000001", "https://[::1]",
    "https://user:password@receiver.example", "https://receiver.example:8443",
    "https://receiver.example/#fragment", "https://oria.example/webhook",
  ])("rejects unsafe destination %s", url => {
    expect(() => forwardingUrl(url)).toThrow();
  });

  it("rejects a hostname resolving to any private address, including mixed DNS answers", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    expect(await sendForwardedWebhook(input)).toMatchObject({ ok: false, status: null, error: expect.stringContaining("DNS") });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("times out DNS resolution and reports a visible failure", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    mocks.lookup.mockReturnValue(new Promise(() => undefined));
    const pending = sendForwardedWebhook(input);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, status: null, error: expect.stringContaining("8 segundos") });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not expose raw network errors or endpoint credentials", async () => {
    mocks.lookup.mockRejectedValue(new Error("private-host-and-token"));
    const result = await sendForwardedWebhook(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-host-and-token");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-host-and-token");
  });

  it("marks synthetic tests without changing their body", async () => {
    await sendForwardedWebhook({ ...input, isTest: true });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ "X-Oria-Webhook-Test": "1" }),
    }), expect.any(Function));
    expect(mocks.end).toHaveBeenCalledWith(input.body);
  });
});
