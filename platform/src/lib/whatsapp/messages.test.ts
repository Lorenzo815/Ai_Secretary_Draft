import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { collection, find, findOne, limit, sort, toArray, updateOne } = vi.hoisted(() => ({
  collection: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  limit: vi.fn(),
  sort: vi.fn(),
  toArray: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
}));

import {
  findLatestInboundWhatsAppMessage,
  getWhatsAppExternalActivityState,
  listWhatsAppMessagesForAssistant,
  listWhatsAppMessagesForCustomer,
  saveWhatsAppMessageEcho,
  type WhatsAppMessageDocument,
} from "./messages";
import { legacyCompanyId } from "../companies/ownership";

describe("WhatsApp message ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ find, findOne });
    find.mockReturnValue({ sort });
    sort.mockReturnValue({ limit });
    limit.mockReturnValue({ toArray });
    toArray.mockResolvedValue([]);
  });

  type StoredMessage = WhatsAppMessageDocument & { companyId: ObjectId };

  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") throw new Error("Expected a MongoDB query object");
    return value as Record<string, unknown>;
  }

  function field(document: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((value, key) => value == null ? undefined : record(value)[key], document);
  }

  function setField(document: unknown, path: string, value: unknown) {
    const keys = path.split(".");
    let target = record(document);
    for (const key of keys.slice(0, -1)) {
      target[key] ??= {};
      target = record(target[key]);
    }
    target[keys.at(-1)!] = value;
  }

  function scalar(value: unknown) {
    if (value instanceof ObjectId) return value.toHexString();
    if (value instanceof Date) return value.getTime();
    return value;
  }

  function matches(document: StoredMessage, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, expected]) => {
      if (key === "$or") return Array.isArray(expected) && expected.some(option => matches(document, record(option)));
      const actual = field(document, key);
      if (expected && typeof expected === "object" && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
        return Object.entries(record(expected)).every(([operator, operand]) => {
          if (operator === "$exists") return (actual !== undefined) === operand;
          if (operator === "$ne") return scalar(actual) !== scalar(operand);
          if (operator === "$lt") {
            const a = scalar(actual);
            const b = scalar(operand);
            return (typeof a === "number" && typeof b === "number" && a < b) ||
              (typeof a === "string" && typeof b === "string" && a < b);
          }
          throw new Error(`Unsupported test operator ${operator}`);
        });
      }
      return scalar(actual) === scalar(expected);
    });
  }

  describe("external WhatsApp message projection", () => {
    const customerId = new ObjectId();
    let stored: StoredMessage[];
    const originalAt = new Date("2026-10-25T18:00:00Z");
    function message(metaMessageId = "wamid.original", timestamp = originalAt) {
      return {
        customerId, metaMessageId, contactPhone: "5511999999999",
        direction: "outbound" as const, type: "text", body: "Original",
        status: "sent" as const, source: "whatsapp_business_app" as const, timestamp,
        externalActivity: { messageId: metaMessageId, timestamp },
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();
      stored = [];
      collection.mockReturnValue({ updateOne, find });
      updateOne.mockImplementation(async (query: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) => {
        let document = stored.find(candidate => matches(candidate, query));
        let inserted = false;
        if (!document && options?.upsert) {
          const insert = update.$setOnInsert as StoredMessage;
          if (stored.some(candidate => candidate.metaMessageId === insert.metaMessageId)) throw new Error("duplicate key");
          document = { ...insert };
          stored.push(document);
          inserted = true;
        }
        if (document) {
          if (update.$set) for (const [key, value] of Object.entries(record(update.$set))) setField(document, key, value);
          if (update.$max) for (const [key, value] of Object.entries(record(update.$max))) {
            const previous = scalar(field(document, key));
            const next = scalar(value);
            if (previous === undefined || (typeof previous === "number" && typeof next === "number" && next > previous)) {
              setField(document, key, value);
            }
          }
          if (update.$unset) for (const key of Object.keys(record(update.$unset))) Reflect.deleteProperty(document, key);
        }
        return { upsertedCount: Number(inserted), matchedCount: Number(Boolean(document)) };
      });
      find.mockImplementation((query: Record<string, unknown>, options?: { projection?: Record<string, number> }) => ({
        sort: () => ({
          toArray: async () => stored.filter(candidate => matches(candidate, query)).map(candidate =>
            Object.fromEntries(Object.entries(candidate).filter(([key]) => !options?.projection || options.projection[key] === 1))),
        }),
      }));
    });

    it("deduplicates replays without modifying the original message", async () => {
      expect(await saveWhatsAppMessageEcho(message())).toEqual({ inserted: true });
      const first = { ...stored[0] };
      expect(await saveWhatsAppMessageEcho(message())).toEqual({ inserted: false });
      expect(stored).toEqual([first]);
      expect(stored[0].companyId).toEqual(legacyCompanyId());
    });

    it("preserves API-originated messages rather than relabeling them as manual", async () => {
      stored.push({
        ...message(), source: undefined, externalActivity: undefined,
        _id: new ObjectId(), companyId: legacyCompanyId(), updatedAt: originalAt, status: "read",
      });
      const first = { ...stored[0] };
      await saveWhatsAppMessageEcho({ ...message(), body: "Do not overwrite" });
      expect(stored).toEqual([first]);
      expect((await getWhatsAppExternalActivityState(customerId)).latestAt).toBeNull();
    });

    it("applies newer edits, ignores old replays and makes revocation terminal", async () => {
      await saveWhatsAppMessageEcho(message());
      const editAt = new Date(originalAt.getTime() + 1_000);
      await saveWhatsAppMessageEcho({
        ...message(), body: "Edited", externalActivity: { messageId: "edit-1", timestamp: editAt },
      }, "edit");
      await saveWhatsAppMessageEcho(message());
      await saveWhatsAppMessageEcho({
        ...message(), body: "Stale edit", externalActivity: { messageId: "edit-old", timestamp: originalAt },
      }, "edit");
      expect(stored[0]).toMatchObject({ body: "Edited", timestamp: originalAt });
      await saveWhatsAppMessageEcho({
        ...message(), type: "revoked", body: "Removed",
        externalActivity: { messageId: "revoke-1", timestamp: new Date(editAt.getTime() + 1_000) },
      }, "revoke");
      await saveWhatsAppMessageEcho({
        ...message(), body: "Cannot resurrect",
        externalActivity: { messageId: "edit-late", timestamp: new Date(editAt.getTime() + 2_000) },
      }, "edit");
      expect(stored[0]).toMatchObject({ body: "Removed", type: "revoked" });
      expect(stored[0].media).toBeUndefined();
    });

    it.each(["edit", "revoke"] as const)("handles %s before the original without restoring stale content", async change => {
      const changeAt = new Date(originalAt.getTime() + 2_000);
      await saveWhatsAppMessageEcho({
        ...message("wamid.original", changeAt),
        type: change === "revoke" ? "revoked" : "text", body: "Effective content",
        externalActivity: { messageId: "change-1", timestamp: changeAt },
      }, change);
      await saveWhatsAppMessageEcho(message());
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ body: "Effective content", timestamp: originalAt });
      expect(stored[0].externalOriginalPending).toBeUndefined();
    });

    it("honors a delayed revoke even when its trigger timestamp precedes an edit", async () => {
      const editAt = new Date(originalAt.getTime() + 2_000);
      await saveWhatsAppMessageEcho(message());
      await saveWhatsAppMessageEcho({
        ...message(), body: "Edited", externalActivity: { messageId: "edit-1", timestamp: editAt },
      }, "edit");
      await saveWhatsAppMessageEcho({
        ...message(), body: "Removed", type: "revoked",
        externalActivity: { messageId: "revoke-1", timestamp: new Date(originalAt.getTime() + 1_000) },
      }, "revoke");
      expect(stored[0]).toMatchObject({ type: "revoked", body: "Removed" });
      expect((await getWhatsAppExternalActivityState(customerId)).latestAt).toEqual(editAt);
    });

    it("detects late older messages and edits without treating duplicate deliveries as context changes", async () => {
      await saveWhatsAppMessageEcho(message());
      const first = await getWhatsAppExternalActivityState(customerId);
      await saveWhatsAppMessageEcho(message());
      expect(await getWhatsAppExternalActivityState(customerId)).toEqual(first);
      await saveWhatsAppMessageEcho(message("wamid.older", new Date(originalAt.getTime() - 10_000)));
      const second = await getWhatsAppExternalActivityState(customerId);
      expect(second.version).not.toBe(first.version);
      expect(second.latestAt).toEqual(originalAt);
      await saveWhatsAppMessageEcho({
        ...message(), body: "New", externalActivity: { messageId: "edit-1", timestamp: new Date(originalAt.getTime() + 1_000) },
      }, "edit");
      expect((await getWhatsAppExternalActivityState(customerId)).version).not.toBe(second.version);
    });

    it("fails closed if the globally unique Meta id belongs to another company", async () => {
      stored.push({ ...message(), companyId: new ObjectId(), _id: new ObjectId(), updatedAt: originalAt });
      await expect(saveWhatsAppMessageEcho(message())).rejects.toThrow("duplicate key");
      expect(stored).toHaveLength(1);
      expect((await getWhatsAppExternalActivityState(customerId)).latestAt).toBeNull();
    });
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
