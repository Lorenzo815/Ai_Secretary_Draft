import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";

const mocks = vi.hoisted(() => ({ updateOne: vi.fn(), createIndex: vi.fn() }));
vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection: () => mocks }) }),
}));

import { scheduleAutomationJob } from "./queue";

beforeEach(() => vi.clearAllMocks());

describe("automation job ownership", () => {
  function evaluate(expression: unknown, document: Record<string, unknown>): unknown {
    if (typeof expression === "string" && expression.startsWith("$")) return document[expression.slice(1)];
    if (expression === null || typeof expression !== "object" || expression instanceof ObjectId) return expression;
    const operator = expression as Record<string, unknown>;
    if ("$type" in operator) {
      const key = String(operator.$type).slice(1);
      return key in document ? (document[key] === null ? "null" : typeof document[key]) : "missing";
    }
    if ("$eq" in operator) {
      const [left, right] = operator.$eq as unknown[];
      return evaluate(left, document) === evaluate(right, document);
    }
    if ("$cond" in operator) {
      const [condition, yes, no] = operator.$cond as unknown[];
      return evaluate(evaluate(condition, document) ? yes : no, document);
    }
    throw new Error("Unexpected ownership expression");
  }

  it("adds only a missing owner and preserves every existing owner on rescheduling and retries", async () => {
    const customerId = new ObjectId();
    const occurredAt = new Date("2026-10-23T19:00:00Z");
    await scheduleAutomationJob({
      process: "customer_agent",
      event: { type: "message.received", customerId, occurredAt, payload: {} },
      debounceMs: 100,
    });
    const [filter, pipeline, options] = mocks.updateOne.mock.calls[0];
    const expression = pipeline[0].$set.companyId;
    expect(filter).toEqual({ process: "customer_agent", customerId });
    expect(options).toEqual({ upsert: true });
    expect(expression).toEqual({
      $cond: [{ $eq: [{ $type: "$companyId" }, "missing"] }, legacyCompanyId(), "$companyId"],
    });
    expect(evaluate(expression, {})).toEqual(legacyCompanyId());
    for (const owner of [legacyCompanyId(), new ObjectId(), null, undefined, "unexpected"]) {
      const document = { companyId: owner };
      expect(evaluate(expression, document)).toBe(owner);
      expect(evaluate(expression, { companyId: evaluate(expression, document) })).toBe(owner);
    }
    expect(pipeline[0].$set).toMatchObject({
      process: { $ifNull: ["$process", "customer_agent"] },
      customerId: { $ifNull: ["$customerId", customerId] },
      revision: { $add: [{ $ifNull: ["$revision", 0] }, 1] },
      status: { $cond: [{ $eq: ["$status", "processing"] }, "processing", "pending"] },
      latestEventAt: occurredAt,
    });
  });
});
