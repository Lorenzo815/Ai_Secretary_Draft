import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { runWithCompany } from "../companies/context";
import { legacyCompanyId } from "../companies/ownership";
import { createDefaultAutomationRules } from "./defaults";

const mocks = vi.hoisted(() => ({
  replaceOne: vi.fn(),
  deleteMany: vi.fn(),
  updateOne: vi.fn(),
  find: vi.fn(() => ({ toArray: async () => [] as Array<{ _id: string }> })),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection: () => mocks }) }),
}));

import { listAutomationRules, replaceAutomationRules } from "./repository";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("automation rule ownership", () => {
  it("stamps seeded rules without changing their business fields", async () => {
    await listAutomationRules();

    const rule = createDefaultAutomationRules()[0];
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: rule._id, companyId: legacyCompanyId() },
      { $setOnInsert: { ...rule, companyId: legacyCompanyId() } },
      { upsert: true },
    );
  });

  it("keeps another company's rules under prefixed ids and returns their logical ids", async () => {
    const companyId = new ObjectId();
    const rule = createDefaultAutomationRules()[0];
    mocks.find.mockReturnValueOnce({
      toArray: async () => [{ ...rule, _id: `${companyId.toHexString()}:${rule._id}` }],
    });

    const rules = await runWithCompany(companyId, () => listAutomationRules());

    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: `${companyId.toHexString()}:${rule._id}`, companyId },
      { $setOnInsert: { ...rule, _id: `${companyId.toHexString()}:${rule._id}`, companyId } },
      { upsert: true },
    );
    expect(mocks.find).toHaveBeenCalledWith({ companyId });
    expect(rules.map((stored) => stored._id)).toEqual([rule._id]);
  });

  it.each([legacyCompanyId().toHexString(), "untrusted-company", null])(
    "replaces serialized rules without trusting client ownership (%s)",
    async companyId => {
      const rule = createDefaultAutomationRules()[0];
      const clientRule = { ...rule, companyId };

      await replaceAutomationRules({ rules: [clientRule], updatedBy: "admin" });

      expect(mocks.replaceOne).toHaveBeenCalledWith(
        { _id: rule._id, companyId: legacyCompanyId() },
        {
          ...rule,
          companyId: legacyCompanyId(),
          updatedAt: new Date(),
          updatedBy: "admin",
        },
        { upsert: true },
      );
      expect(clientRule.companyId).toBe(companyId);
    },
  );
});
