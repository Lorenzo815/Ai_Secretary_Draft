import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { collection, find, findOne, limit, sort, toArray } = vi.hoisted(() => ({
  collection: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  limit: vi.fn(),
  sort: vi.fn(),
  toArray: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
}));

import {
  findLatestInboundWhatsAppMessage,
  listWhatsAppMessagesForAssistant,
  listWhatsAppMessagesForCustomer,
} from "./messages";

describe("WhatsApp message ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ find, findOne });
    find.mockReturnValue({ sort });
    sort.mockReturnValue({ limit });
    limit.mockReturnValue({ toArray });
    toArray.mockResolvedValue([]);
  });

  it("uses the message id to deterministically order messages with the same timestamp", async () => {
    const customerId = new ObjectId();

    await listWhatsAppMessagesForAssistant(customerId);
    expect(sort).toHaveBeenLastCalledWith({ timestamp: -1, _id: -1 });

    await listWhatsAppMessagesForCustomer(customerId, ["5542999999999"]);
    expect(sort).toHaveBeenLastCalledWith({ timestamp: 1, _id: 1 });
  });

  it("uses the same tie-breaker when checking the latest inbound message", async () => {
    const customerId = new ObjectId();
    findOne.mockResolvedValue(null);

    await findLatestInboundWhatsAppMessage(customerId, ["5542999999999"]);

    expect(findOne).toHaveBeenCalledWith(
      {
        direction: "inbound",
        $or: [
          { customerId },
          { contactPhone: { $in: ["5542999999999"] } },
        ],
      },
      { sort: { timestamp: -1, _id: -1 } },
    );
  });
});
