import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("./login-form", () => ({ default: () => null }));

import LoginPage from "./page";

describe("revoked login sessions", () => {
  it("renders login instead of redirecting stale sessions back into the dashboard", async () => {
    mocks.session.mockResolvedValue({ user: { id: "" }, principal: null });
    mocks.redirect.mockClear();
    expect(await LoginPage({ searchParams: Promise.resolve({}) })).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("redirects only a validated authenticated session", async () => {
    mocks.session.mockResolvedValue({ principal: { id: "user" } });
    await expect(LoginPage({ searchParams: Promise.resolve({ callbackUrl: "/dashboard/settings" }) })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard/settings");
  });
});
