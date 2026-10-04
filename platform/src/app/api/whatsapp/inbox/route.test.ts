import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ConflictError extends Error {}
  return {
    ConflictError,
    getServerSession: vi.fn(),
    getWhatsAppInboxDetail: vi.fn(),
    listWhatsAppInboxConversations: vi.fn(),
    resolveWhatsAppInboxAttention: vi.fn(),
  };
});

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/whatsapp", () => ({
  getWhatsAppInboxDetail: mocks.getWhatsAppInboxDetail,
  listWhatsAppInboxConversations: mocks.listWhatsAppInboxConversations,
  resolveWhatsAppInboxAttention: mocks.resolveWhatsAppInboxAttention,
  WhatsAppInboxConflictError: mocks.ConflictError,
}));

import { GET, PATCH } from "./route";

describe("/api/whatsapp/inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "team@example.com" } });
    mocks.listWhatsAppInboxConversations.mockResolvedValue([]);
  });

  it("does not return details for a conversation outside the active window", async () => {
    const customerId = new ObjectId().toString();

    const response = await GET(new Request(`http://localhost/api/whatsapp/inbox?customerId=${customerId}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations: [], detail: null });
    expect(mocks.getWhatsAppInboxDetail).not.toHaveBeenCalled();
    expect(mocks.listWhatsAppInboxConversations).toHaveBeenCalledWith({
      includeOutsideWindow: false,
      startAt: undefined,
      endAt: undefined,
    });
  });

  it("forwards a custom historical period to the inbox query", async () => {
    const startAt = "2026-09-01T03:00:00.000Z";
    const endAt = "2026-10-05T02:59:59.999Z";

    const response = await GET(new Request(
      `http://localhost/api/whatsapp/inbox?includeOutsideWindow=true&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.listWhatsAppInboxConversations).toHaveBeenCalledWith({
      includeOutsideWindow: true,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
    });
  });

  it("rejects an inverted historical period", async () => {
    const response = await GET(new Request(
      "http://localhost/api/whatsapp/inbox?includeOutsideWindow=true&startAt=2026-10-04T00%3A00%3A00.000Z&endAt=2026-09-01T00%3A00%3A00.000Z",
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Período de conversas inválido." });
    expect(mocks.listWhatsAppInboxConversations).not.toHaveBeenCalled();
  });

  it("returns conflict when a newer message arrived before resolution", async () => {
    const customerId = new ObjectId().toString();
    mocks.resolveWhatsAppInboxAttention.mockRejectedValue(
      new mocks.ConflictError("Uma mensagem mais recente alterou a conversa."),
    );

    const response = await PATCH(new Request("http://localhost/api/whatsapp/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, messageId: "expected-message" }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Uma mensagem mais recente alterou a conversa.",
    });
    expect(mocks.resolveWhatsAppInboxAttention).toHaveBeenCalledWith(
      new ObjectId(customerId),
      "expected-message",
      "team@example.com",
    );
  });
});
