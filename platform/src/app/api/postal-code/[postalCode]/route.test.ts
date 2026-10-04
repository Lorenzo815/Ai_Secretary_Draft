import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, resolvePostalCode } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolvePostalCode: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/crm", () => ({ resolvePostalCode }));

import { GET } from "./route";

describe("GET /api/postal-code/[postalCode]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ postalCode: "12345678" }),
    });

    expect(response.status).toBe(401);
    expect(resolvePostalCode).not.toHaveBeenCalled();
  });

  it("returns the resolved address without caching it", async () => {
    getServerSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    resolvePostalCode.mockResolvedValue({
      postalCode: "12345678",
      street: "Rua Exemplo",
      neighborhood: "Centro",
      city: "Curitiba",
      state: "PR",
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ postalCode: "12345678" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      address: {
        postalCode: "12345678",
        street: "Rua Exemplo",
        neighborhood: "Centro",
        city: "Curitiba",
        state: "PR",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
