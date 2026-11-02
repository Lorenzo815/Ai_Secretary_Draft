import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPermissions, type Principal } from "./lib/access/contracts";

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), resolveToken: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("./lib/access/session", () => ({ resolveToken: mocks.resolveToken }));
import { proxy } from "./proxy";

const user: Principal = { id: "user", companyId: "company", companyName: "Company", name: "Test", email: "test@example.com", isAdmin: false, permissions: emptyPermissions() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  vi.stubEnv("ORIA_MOVED_NOTICE", "off");
  mocks.getToken.mockResolvedValue({});
  mocks.resolveToken.mockResolvedValue(user);
});

describe("moved notice", () => {
  beforeEach(() => vi.stubEnv("ORIA_MOVED_NOTICE", ""));

  it.each(["/", "/login", "/dashboard", "/dashboard/settings/system?tab=x"])("shows the notice instead of %s", async (path) => {
    const response = await proxy(new NextRequest(`https://oria.example${path}`));
    const rewrite = new URL(response.headers.get("x-middleware-rewrite")!);
    expect(rewrite.pathname).toBe("/mudamos");
    expect(rewrite.searchParams.get("from")).toBe(path);
    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });

  it("keeps webhooks and the worker reachable", async () => {
    const response = await proxy(new NextRequest("https://oria.example/api/webhooks/whatsapp", { method: "POST" }));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("restores the previous behaviour when turned off", async () => {
    vi.stubEnv("ORIA_MOVED_NOTICE", "off");
    expect((await proxy(new NextRequest("https://oria.example/login"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(new NextRequest("https://oria.example/dashboard/calendario"))).headers.get("location"))
      .toBe("https://oria.example/dashboard/access-denied");
  });
});

describe("server request authorization", () => {
  it("rejects unauthenticated APIs before handlers execute", async () => {
    mocks.resolveToken.mockResolvedValue(null);
    expect((await proxy(new NextRequest("http://localhost:3000/api/calendar"))).status).toBe(401);
  });
  it("reads the secure cookie on Vercel even when NEXTAUTH_URL points at localhost", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    await proxy(new NextRequest("https://oria.example/api/company/settings"));
    expect(mocks.getToken).toHaveBeenCalledWith(expect.objectContaining({
      cookieName: "__Secure-next-auth.session-token", secureCookie: true,
    }));
    vi.unstubAllEnvs();
  });
  it("protects direct pages and RSC requests, not just sidebar navigation", async () => {
    const result = await proxy(new NextRequest("http://localhost:3000/dashboard/calendario", { headers: { RSC: "1" } }));
    expect(result.headers.get("location")).toBe("http://localhost:3000/dashboard/access-denied");
    expect((await proxy(new NextRequest("http://localhost:3000/api/calendar"))).status).toBe(403);
  });
  it("permits reads but rejects writes for read-only accounts", async () => {
    mocks.resolveToken.mockResolvedValue({ ...user, permissions: { ...emptyPermissions(), calendar: "read" } });
    expect((await proxy(new NextRequest("http://localhost:3000/api/calendar"))).status).toBe(200);
    expect((await proxy(new NextRequest("http://localhost:3000/api/calendar", { method: "POST", headers: { Origin: "http://localhost:3000" } }))).status).toBe(403);
  });
  it("rejects cross-origin and originless management requests, even for admins", async () => {
    mocks.resolveToken.mockResolvedValue({ ...user, isAdmin: true });
    for (const origin of [undefined, "https://another.example"]) {
      const headers = origin ? { Origin: origin } : undefined;
      expect((await proxy(new NextRequest("http://localhost:3000/api/company/users", { method: "POST", headers }))).status).toBe(403);
    }
  });
  it("allows same-origin authorized writes and disables response caching", async () => {
    mocks.resolveToken.mockResolvedValue({ ...user, isAdmin: true });
    const result = await proxy(new NextRequest("http://localhost:3000/api/company/users", {
      method: "POST", headers: { Origin: "http://localhost:3000" },
    }));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("leaves signed machine/webhook handlers responsible for their existing authentication", async () => {
    const result = await proxy(new NextRequest("http://localhost:3000/api/webhooks/whatsapp", { method: "POST" }));
    expect(result.status).toBe(200);
    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });
  it("fails closed when database validation is unavailable", async () => {
    mocks.resolveToken.mockRejectedValue(new Error("private database details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await proxy(new NextRequest("http://localhost:3000/api/calendar"));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private database details");
    log.mockRestore();
  });
});
