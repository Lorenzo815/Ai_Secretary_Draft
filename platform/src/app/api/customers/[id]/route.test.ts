import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findCustomerById, getServerSession, updateCustomer } = vi.hoisted(() => ({
  findCustomerById: vi.fn(),
  getServerSession: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/crm", () => ({ findCustomerById, updateCustomer }));

import { GET } from "./route";

describe("GET /api/customers/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an authenticated session", async () => {
    getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: new ObjectId().toString() }),
    });

    expect(response.status).toBe(401);
    expect(findCustomerById).not.toHaveBeenCalled();
  });

  it("returns the current primary phone without exposing the complete profile", async () => {
    const customerId = new ObjectId();
    getServerSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    findCustomerById.mockResolvedValue({
      _id: customerId,
      name: "Alice",
      phones: ["5542999999999", "5542888888888"],
      profile: { cpf: { encrypted: "protected" } },
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: customerId.toString() }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      customer: {
        id: customerId.toString(),
        name: "Alice",
        phone: "5542999999999",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(findCustomerById).toHaveBeenCalledWith(customerId.toString());
  });

  it("returns not found when the linked customer no longer exists", async () => {
    getServerSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    findCustomerById.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: new ObjectId().toString() }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Cliente não encontrado." });
  });
});
