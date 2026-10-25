import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPermissions } from "@/lib/access/contracts";

const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), save: vi.fn(), test: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: {}, getMongoClient: vi.fn() }));
vi.mock("@/lib/whatsapp/forwarding", () => ({
  getForwardingSettings: mocks.get, saveForwardingSettings: mocks.save, testForwardingEndpoint: mocks.test,
}));
import { GET, PUT, POST } from "./route";

const principal = {
  id: "123456789012345678901234", companyId: "9b9d1f4b4f16cf6e84abcce4",
  name: "Admin", email: "admin@example.com", companyName: "Company", isAdmin: true, permissions: emptyPermissions(),
};
const settings = { revision: 0, endpoints: [], deliveries: [] };
function request(method: "PUT" | "POST", body: unknown) {
  return new Request("http://localhost:3000/api/company/webhook-forwarding", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ principal });
  mocks.get.mockResolvedValue(settings);
  mocks.save.mockResolvedValue(settings);
  mocks.test.mockResolvedValue({ result: { ok: true, status: 200, durationMs: 2, error: null }, settings });
});

describe("admin-only company forwarding API", () => {
  it.each([null, { principal: null }])("rejects a missing or revoked principal", async session => {
    mocks.session.mockResolvedValue(session);
    expect((await GET()).status).toBe(401);
    expect((await PUT(request("PUT", { revision: 0, endpoints: [] }))).status).toBe(401);
    expect((await POST(request("POST", { endpointId: "saved-id" }))).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.test).not.toHaveBeenCalled();
  });
  it("denies non-admins even with System manage permission", async () => {
    mocks.session.mockResolvedValue({ principal: { ...principal, isAdmin: false, permissions: { ...emptyPermissions(), system: "manage" } } });
    expect((await GET()).status).toBe(403);
    expect((await PUT(request("PUT", { revision: 0, endpoints: [] }))).status).toBe(403);
    expect((await POST(request("POST", { endpointId: "saved-id" }))).status).toBe(403);
    expect(mocks.test).not.toHaveBeenCalled();
  });
  it("takes company ownership only from the revalidated server principal", async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(principal);
    expect((await PUT(request("PUT", { revision: 0, endpoints: [] }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(principal, { revision: 0, endpoints: [] });
    const response = await POST(request("POST", { endpointId: "saved-id" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.test).toHaveBeenCalledExactlyOnceWith(principal, "saved-id");
  });
  it("never tests arbitrary URLs or client-supplied company scopes", async () => {
    for (const body of [{ url: "https://attacker.example" }, { endpointId: "saved-id", companyId: "foreign" }, null]) {
      expect((await POST(request("POST", body))).status).toBe(400);
    }
    expect(mocks.test).not.toHaveBeenCalled();
  });
  it("returns the real upstream test result rather than treating other HTTP statuses as success", async () => {
    mocks.test.mockResolvedValue({ result: { ok: false, status: 201, durationMs: 2, error: "Esperado HTTP 200." }, settings });
    const response = await POST(request("POST", { endpointId: "saved-id" }));
    expect((await response.json()).result).toMatchObject({ ok: false, status: 201 });
  });
});
