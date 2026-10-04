import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  aggregateToArray: vi.fn(),
  collection: vi.fn(),
  customerFind: vi.fn(),
  customerFindOne: vi.fn(),
  customerToArray: vi.fn(),
  findLatestWhatsAppMessage: vi.fn(),
  messageFind: vi.fn(),
  messageSort: vi.fn(),
  messageToArray: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection: mocks.collection }) }),
}));

vi.mock("./messages", () => ({
  findLatestInboundWhatsAppMessage: vi.fn(),
  findLatestWhatsAppMessage: mocks.findLatestWhatsAppMessage,
  listWhatsAppMessagesForCustomer: vi.fn(),
}));

import {
  listActiveWhatsAppInboxConversations,
  listWhatsAppInboxConversations,
  resolveWhatsAppInboxAttention,
  WhatsAppInboxConflictError,
} from "./inbox";

function message(input: {
  id?: ObjectId;
  customerId?: ObjectId;
  phone: string;
  metaMessageId: string;
  direction: "inbound" | "outbound";
  timestamp: string;
}) {
  return {
    _id: input.id ?? new ObjectId(),
    customerId: input.customerId,
    metaMessageId: input.metaMessageId,
    contactPhone: input.phone,
    direction: input.direction,
    type: "text",
    body: input.metaMessageId,
    status: input.direction === "inbound" ? "received" : "sent",
    timestamp: new Date(input.timestamp),
  };
}

describe("WhatsApp inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collection.mockImplementation((name: string) => {
      if (name === "whatsapp_messages") {
        return {
          aggregate: mocks.aggregate,
          find: mocks.messageFind,
        };
      }
      return {
        find: mocks.customerFind,
        findOne: mocks.customerFindOne,
        updateOne: mocks.updateOne,
      };
    });
    mocks.messageFind.mockReturnValue({ sort: mocks.messageSort });
    mocks.messageSort.mockReturnValue({ toArray: mocks.messageToArray });
    mocks.customerFind.mockReturnValue({ toArray: mocks.customerToArray });
    mocks.aggregate.mockReturnValue({ toArray: mocks.aggregateToArray });
    mocks.messageToArray.mockResolvedValue([]);
    mocks.customerToArray.mockResolvedValue([]);
    mocks.aggregateToArray.mockResolvedValue([]);
  });

  it("lists only recent conversations, resolves legacy phone aliases, and orders by latest activity", async () => {
    const now = new Date("2026-09-29T15:00:00.000Z");
    const directId = new ObjectId();
    const legacyId = new ObjectId();
    const resolvedId = new ObjectId();
    const directInbound = message({
      customerId: directId,
      phone: "5542999999999",
      metaMessageId: "direct-inbound",
      direction: "inbound",
      timestamp: "2026-09-29T14:40:00.000Z",
    });
    const legacyInbound = message({
      phone: "554288076200",
      metaMessageId: "legacy-inbound",
      direction: "inbound",
      timestamp: "2026-09-29T14:30:00.000Z",
    });
    const resolvedInbound = message({
      customerId: resolvedId,
      phone: "5542977777777",
      metaMessageId: "resolved-inbound",
      direction: "inbound",
      timestamp: "2026-09-29T14:20:00.000Z",
    });
    const legacyOutbound = message({
      customerId: legacyId,
      phone: "5542988076200",
      metaMessageId: "legacy-outbound",
      direction: "outbound",
      timestamp: "2026-09-29T14:50:00.000Z",
    });

    mocks.messageToArray.mockResolvedValue([directInbound, legacyInbound, resolvedInbound]);
    mocks.customerToArray.mockResolvedValue([
      {
        _id: directId,
        name: "Alice",
        phones: ["5542999999999"],
        serviceStatus: "waiting_human",
        whatsappAttention: { resolvedThroughMessageId: "older-message" },
      },
      {
        _id: legacyId,
        name: "Lorenzo",
        phones: ["5542988076200"],
        serviceStatus: "human_active",
      },
      {
        _id: resolvedId,
        name: "Resolvida",
        phones: ["5542977777777"],
        whatsappAttention: { resolvedThroughMessageId: "resolved-inbound" },
      },
    ]);
    mocks.aggregateToArray.mockResolvedValue([
      { latest: directInbound },
      { latest: legacyOutbound },
      { latest: resolvedInbound },
    ]);

    const conversations = await listActiveWhatsAppInboxConversations(now);

    expect(conversations.map((conversation) => conversation.customerName)).toEqual([
      "Lorenzo",
      "Alice",
      "Resolvida",
    ]);
    expect(conversations[0]).toMatchObject({
      customerId: legacyId.toString(),
      phone: "5542988076200",
      needsAttention: false,
      resolvedUntilNextMessage: false,
      lastMessage: { direction: "outbound", messageId: "legacy-outbound" },
    });
    expect(conversations[1]).toMatchObject({
      needsAttention: true,
      resolvedUntilNextMessage: false,
    });
    expect(conversations[2]).toMatchObject({
      needsAttention: false,
      resolvedUntilNextMessage: true,
    });
    const inboxFilter = mocks.messageFind.mock.calls[0]?.[0] as {
      timestamp: { $gt: Date };
    };
    expect(inboxFilter.timestamp.$gt).toEqual(new Date("2026-09-28T15:00:00.000Z"));
    const customerFilter = mocks.customerFind.mock.calls[0]?.[0] as {
      $or: Array<{ phones?: { $in: string[] } }>;
    };
    expect(customerFilter.$or.flatMap((filter) => filter.phones?.$in ?? [])).toEqual(
      expect.arrayContaining(["554288076200", "5542988076200"]),
    );
  });

  it("marks the current inbound message as resolved", async () => {
    const customerId = new ObjectId();
    const latest = message({
      customerId,
      phone: "5542999999999",
      metaMessageId: "current-message",
      direction: "inbound",
      timestamp: "2026-09-29T14:40:00.000Z",
    });

    mocks.customerFindOne.mockResolvedValue({
      _id: customerId,
      phones: ["5542999999999"],
    });
    mocks.findLatestWhatsAppMessage.mockResolvedValue(latest);
    mocks.updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1 });

    await resolveWhatsAppInboxAttention(customerId, "current-message", "team@example.com");

    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: customerId },
      {
        $set: {
          whatsappAttention: {
            resolvedThroughMessageId: "current-message",
            resolvedAt: expect.any(Date),
            resolvedBy: "team@example.com",
          },
          updatedAt: expect.any(Date),
        },
      },
    );
  });

  it("includes conversations outside the service window within a custom period", async () => {
    const customerId = new ObjectId();
    const historicalMessage = message({
      customerId,
      phone: "5542999999999",
      metaMessageId: "historical-outbound",
      direction: "outbound",
      timestamp: "2026-09-10T12:00:00.000Z",
    });
    const historicalInbound = message({
      customerId,
      phone: "5542999999999",
      metaMessageId: "historical-inbound",
      direction: "inbound",
      timestamp: "2026-09-09T12:00:00.000Z",
    });
    mocks.aggregateToArray
      .mockResolvedValueOnce([{ latest: historicalMessage }])
      .mockResolvedValueOnce([{ latest: historicalInbound }]);
    mocks.customerToArray.mockResolvedValue([{
      _id: customerId,
      name: "Cliente histórico",
      phones: ["5542999999999"],
      serviceStatus: "closed",
    }]);
    const startAt = new Date("2026-09-01T00:00:00.000Z");
    const endAt = new Date("2026-09-30T23:59:59.999Z");

    const conversations = await listWhatsAppInboxConversations({
      includeOutsideWindow: true,
      startAt,
      endAt,
      now: new Date("2026-10-04T15:00:00.000Z"),
    });

    expect(conversations).toEqual([
      expect.objectContaining({
        customerId: customerId.toString(),
        customerName: "Cliente histórico",
        withinServiceWindow: false,
        lastInboundAt: historicalInbound.timestamp.toISOString(),
        lastMessage: expect.objectContaining({
          messageId: "historical-outbound",
          direction: "outbound",
        }),
      }),
    ]);
    expect(mocks.messageFind).not.toHaveBeenCalled();
    const candidatePipeline = mocks.aggregate.mock.calls[0]?.[0] as Array<{
      $match?: { timestamp?: { $gte: Date; $lte: Date } };
    }>;
    expect(candidatePipeline[0]?.$match?.timestamp).toEqual({ $gte: startAt, $lte: endAt });
  });

  it("rejects resolution when a newer message changed the conversation", async () => {
    const customerId = new ObjectId();
    mocks.customerFindOne.mockResolvedValue({
      _id: customerId,
      phones: ["5542999999999"],
    });
    mocks.findLatestWhatsAppMessage.mockResolvedValue(message({
      customerId,
      phone: "5542999999999",
      metaMessageId: "new-message",
      direction: "inbound",
      timestamp: "2026-09-29T14:45:00.000Z",
    }));

    await expect(
      resolveWhatsAppInboxAttention(customerId, "old-message", "team@example.com"),
    ).rejects.toBeInstanceOf(WhatsAppInboxConflictError);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});
