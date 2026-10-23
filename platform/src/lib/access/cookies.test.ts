import { NextRequest } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionCookie } from "./cookies";

afterEach(() => vi.unstubAllEnvs());

describe("shared NextAuth/proxy session cookies", () => {
  it.each([
    { vercel: "1", url: "http://localhost:3000", secure: true },
    { vercel: "1", url: undefined, secure: true },
    { vercel: undefined, url: "https://oria.example", secure: true },
    { vercel: undefined, url: "http://localhost:3000", secure: false },
  ])("selects secure=$secure for Vercel=$vercel URL=$url", async ({ vercel, url, secure }) => {
    vi.stubEnv("VERCEL", vercel);
    vi.stubEnv("NEXTAUTH_URL", url);
    const cookie = sessionCookie();
    expect(cookie.options).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure });
    expect(cookie.name).toBe(secure ? "__Secure-next-auth.session-token" : "next-auth.session-token");
    const secret = "cookie-test-secret";
    const token = await encode({ secret, token: { id: "test", accessFingerprint: "signed-state" } });
    const req = new NextRequest("https://oria.example/dashboard/settings", { headers: { Cookie: `${cookie.name}=${token}` } });
    expect(await getToken({ req, secret, cookieName: cookie.name, secureCookie: cookie.options.secure })).toMatchObject({ id: "test", accessFingerprint: "signed-state" });
  });
  it("reads chunked secure cookies without accepting the insecure name in production", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    const cookie = sessionCookie();
    const secret = "cookie-test-secret";
    const token = await encode({ secret, token: { id: "test" } });
    const split = Math.floor(token.length / 2);
    const req = new NextRequest("https://oria.example/dashboard", {
      headers: { Cookie: `${cookie.name}.1=${token.slice(split)}; ${cookie.name}.0=${token.slice(0, split)}` },
    });
    expect(await getToken({ req, secret, cookieName: cookie.name, secureCookie: true })).toMatchObject({ id: "test" });
    const insecure = new NextRequest("https://oria.example/dashboard", { headers: { Cookie: `next-auth.session-token=${token}` } });
    expect(await getToken({ req: insecure, secret, cookieName: cookie.name, secureCookie: true })).toBeNull();
  });
});
