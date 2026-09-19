import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, revealCustomerCpf } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  revealCustomerCpf: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/crm", () => ({ revealCustomerCpf }));

import { GET } from "./route";

describe("GET /api/customers/[id]/cpf", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not reveal a CPF without an authenticated session", async () => {
    getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: new ObjectId().toString() }),
    });

    expect(response.status).toBe(401);
    expect(revealCustomerCpf).not.toHaveBeenCalled();
  });

  it("returns a formatted CPF without allowing response caching", async () => {
    const customerId = new ObjectId();
    getServerSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    revealCustomerCpf.mockResolvedValue("52998224725");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: customerId.toString() }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cpf: "529.982.247-25" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(revealCustomerCpf).toHaveBeenCalledWith(customerId);
  });
});
