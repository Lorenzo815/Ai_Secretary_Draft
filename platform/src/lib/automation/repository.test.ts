import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";
import { createDefaultAutomationRules } from "./defaults";

const mocks = vi.hoisted(() => ({
  replaceOne: vi.fn(),
  deleteMany: vi.fn(),
  updateOne: vi.fn(),
  find: vi.fn(() => ({ sort: () => ({ toArray: async () => [] }) })),
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
      { _id: rule._id },
      { $setOnInsert: { ...rule, companyId: legacyCompanyId() } },
      { upsert: true },
    );
  });

  it.each([legacyCompanyId().toHexString(), "untrusted-company", null])(
    "replaces serialized rules without trusting client ownership (%s)",
    async companyId => {
      const rule = createDefaultAutomationRules()[0];
      const clientRule = { ...rule, companyId };

      await replaceAutomationRules({ rules: [clientRule], updatedBy: "admin" });

      expect(mocks.replaceOne).toHaveBeenCalledWith(
        { _id: rule._id },
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
