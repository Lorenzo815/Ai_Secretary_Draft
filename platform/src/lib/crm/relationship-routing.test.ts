import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createIndex: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn() }));
vi.mock("../mongodb", () => ({ default: Promise.resolve({ db: () => ({ collection: () => mocks }) }) }));

import { classifyCustomerRelationship, updateCustomerProfile } from "./customers";

describe("relationship classification and service routing", () => {
  const customerId = new ObjectId();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findOneAndUpdate.mockResolvedValue({ _id: customerId });
  });

  describe.each(["new", "returning"] as const)("%s classification", status => {
    it.each(["ai_active", "waiting_human", "human_active", "closed"] as const)("preserves %s when no routing was requested", async serviceStatus => {
      mocks.findOne.mockResolvedValue({ _id: customerId, phones: [], serviceStatus });

      await classifyCustomerRelationship(customerId, status);
      await updateCustomerProfile(customerId, { relationshipStatus: status });

      expect(mocks.findOneAndUpdate).toHaveBeenCalledTimes(2);
      for (const [filter, update] of mocks.findOneAndUpdate.mock.calls) {
        expect(filter).toEqual({ _id: customerId });
        expect(update.$set).toMatchObject({ relationship: { status, source: "customer" } });
        expect(update.$set).not.toHaveProperty("serviceStatus");
      }
    });

    it.each(["ai_active", "waiting_human"] as const)("atomically applies explicitly requested %s routing", async serviceStatus => {
      mocks.findOne.mockResolvedValue({ _id: customerId, phones: [], serviceStatus: "ai_active" });

      await classifyCustomerRelationship(customerId, status, { serviceStatus });
      await updateCustomerProfile(customerId, { relationshipStatus: status }, { serviceStatus });

      for (const [filter, update] of mocks.findOneAndUpdate.mock.calls) {
        expect(filter).toEqual({ _id: customerId });
        expect(update.$set).toMatchObject({
          relationship: { status, source: "customer" }, serviceStatus,
        });
      }
    });
  });

  it("does not reroute an already classified customer when updating other profile fields", async () => {
    mocks.findOne.mockResolvedValue({
      _id: customerId, phones: [], serviceStatus: "human_active",
      relationship: { status: "returning", source: "customer", classifiedAt: new Date() },
    });

    await updateCustomerProfile(customerId, { relationshipStatus: "returning", profession: "Engineer" }, { serviceStatus: "ai_active" });

    const update = mocks.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).not.toHaveProperty("relationship");
    expect(update.$set).not.toHaveProperty("serviceStatus");
    expect(update.$set).toHaveProperty("profile.profession", "Engineer");
  });

  it("ignores routing when the profile update contains no relationship classification", async () => {
    mocks.findOne.mockResolvedValue({ _id: customerId, phones: [], serviceStatus: "waiting_human" });

    await updateCustomerProfile(customerId, { profession: "Engineer" }, { serviceStatus: "ai_active" });

    expect(mocks.findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty("serviceStatus");
  });
});
