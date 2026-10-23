import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { collection, deleteMany, findOne, updateOne, findActiveJob, findActiveAnalysis, startSession, withTransaction, endSession } = vi.hoisted(() => ({
  collection: vi.fn(),
  deleteMany: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
  findActiveJob: vi.fn(),
  findActiveAnalysis: vi.fn(),
  startSession: vi.fn(),
  withTransaction: vi.fn(),
  endSession: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection }),
    startSession,
  }),
}));

import { ChatHistoryInProgressError, clearChatHistoryForCustomer, clearDynamicDataForCustomer, CUSTOMER_CHAT_COLLECTIONS, DYNAMIC_COLLECTIONS } from "./database";

describe("clearDynamicDataForCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOne.mockResolvedValue({ phones: ["5542999990000"] });
    deleteMany.mockResolvedValue({ deletedCount: 1 });
    collection.mockImplementation((name: string) => ({
      ...(name === "crm_customers" ? { findOne } : {}),
      deleteMany,
    }));
  });

  describe("clearChatHistoryForCustomer", () => {
    const session = { withTransaction, endSession };

    beforeEach(() => {
      vi.clearAllMocks();
      startSession.mockReturnValue(session);
      withTransaction.mockImplementation(async (callback: () => Promise<unknown>) => callback());
      findOne.mockResolvedValue({ phones: ["5542999990000"] });
      findActiveJob.mockResolvedValue(null);
      findActiveAnalysis.mockResolvedValue(null);
      deleteMany.mockResolvedValue({ deletedCount: 1 });
      updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      collection.mockImplementation((name: string) => ({
        findOne: name === "crm_customers" ? findOne : name === "automation_jobs" ? findActiveJob : findActiveAnalysis,
        updateOne,
        deleteMany,
      }));
    });

    it("atomically clears only the selected conversation and its AI memory", async () => {
      const customerId = new ObjectId();

      const result = await clearChatHistoryForCustomer(customerId);

      expect(result).toEqual(Object.fromEntries(CUSTOMER_CHAT_COLLECTIONS.map(name => [name, 1])));
      expect(withTransaction).toHaveBeenCalledOnce();
      expect(deleteMany).toHaveBeenCalledTimes(CUSTOMER_CHAT_COLLECTIONS.length);
      for (const [, options] of deleteMany.mock.calls) expect(options).toEqual({ session });
      expect(updateOne).toHaveBeenCalledExactlyOnceWith(
        { _id: customerId },
        { $unset: { leadQualification: "", whatsappAttention: "" }, $set: { updatedAt: expect.any(Date) } },
        { session },
      );
      expect(endSession).toHaveBeenCalledOnce();
    });

    it("preserves the customer record, appointments, holds, payments and usage metrics", async () => {
      await clearChatHistoryForCustomer(new ObjectId());

      expect(collection.mock.calls.map(([name]) => name)).toEqual([
        "crm_customers", "automation_jobs", "lead_qualification_locks", ...CUSTOMER_CHAT_COLLECTIONS,
      ]);
      expect(CUSTOMER_CHAT_COLLECTIONS).not.toContain("crm_customers");
      expect(CUSTOMER_CHAT_COLLECTIONS).not.toContain("calendar_appointments");
      expect(CUSTOMER_CHAT_COLLECTIONS).not.toContain("calendar_plan_options");
      expect(CUSTOMER_CHAT_COLLECTIONS).not.toContain("payment_requests");
      expect(CUSTOMER_CHAT_COLLECTIONS).not.toContain("ai_task_calls");
    });

    it("limits pending job cleanup to the selected customer's conversation processes", async () => {
      const customerId = new ObjectId();
      const filter = { customerId, process: { $in: ["customer_agent", "customer_follow_up", "lead_qualification"] } };

      await clearChatHistoryForCustomer(customerId);

      expect(findActiveJob).toHaveBeenCalledWith(
        { ...filter, status: "processing" }, { projection: { _id: 1 }, session },
      );
      expect(deleteMany).toHaveBeenCalledWith(filter, { session });
    });

    it("includes legacy phone aliases without deleting messages owned by another customer", async () => {
      const customerId = new ObjectId();

      await clearChatHistoryForCustomer(customerId);

      expect(deleteMany).toHaveBeenCalledWith({
        $or: [
          { customerId },
          { customerId: null, contactPhone: { $in: ["5542999990000", "554299990000"] } },
        ],
      }, { session });
    });

    it("does not broaden message deletion when the customer has no phones", async () => {
      const customerId = new ObjectId();
      findOne.mockResolvedValue({ phones: [] });

      await clearChatHistoryForCustomer(customerId);

      expect(deleteMany).toHaveBeenCalledWith({
        $or: [{ customerId }, { customerId: null, contactPhone: { $in: [] } }],
      }, { session });
    });

    it("does not modify anything for an unknown customer", async () => {
      findOne.mockResolvedValue(null);

      await expect(clearChatHistoryForCustomer(new ObjectId())).resolves.toBeNull();

      expect(deleteMany).not.toHaveBeenCalled();
      expect(updateOne).not.toHaveBeenCalled();
      expect(endSession).toHaveBeenCalledOnce();
    });

    it.each(["job", "analysis"])("refuses cleanup while a customer %s is running", async (kind) => {
      (kind === "job" ? findActiveJob : findActiveAnalysis).mockResolvedValue({ _id: new ObjectId() });

      await expect(clearChatHistoryForCustomer(new ObjectId())).rejects.toBeInstanceOf(ChatHistoryInProgressError);

      expect(deleteMany).not.toHaveBeenCalled();
      expect(updateOne).not.toHaveBeenCalled();
      expect(endSession).toHaveBeenCalledOnce();
    });

    it("propagates deletion errors through the transaction and closes the session", async () => {
      deleteMany.mockRejectedValueOnce(new Error("delete failed"));

      await expect(clearChatHistoryForCustomer(new ObjectId())).rejects.toThrow("delete failed");

      expect(updateOne).not.toHaveBeenCalled();
      expect(endSession).toHaveBeenCalledOnce();
    });

    it("does not report success when clearing derived conversation fields fails", async () => {
      updateOne.mockRejectedValueOnce(new Error("update failed"));

      await expect(clearChatHistoryForCustomer(new ObjectId())).rejects.toThrow("update failed");

      expect(endSession).toHaveBeenCalledOnce();
    });
  });

  it("deletes only records linked to the selected customer", async () => {
    const customerId = new ObjectId();

    const result = await clearDynamicDataForCustomer(customerId);

    expect(result).toEqual(Object.fromEntries(DYNAMIC_COLLECTIONS.map((name) => [name, 1])));
    expect(deleteMany).toHaveBeenCalledTimes(DYNAMIC_COLLECTIONS.length);
    expect(deleteMany).toHaveBeenCalledWith({ _id: customerId });
    expect(deleteMany).toHaveBeenCalledWith({ customerId });
    expect(deleteMany).toHaveBeenCalledWith({
      $or: [
        { customerId },
        { contactPhone: { $in: ["5542999990000"] } },
      ],
    });
  });

  it("does not delete anything when the customer does not exist", async () => {
    findOne.mockResolvedValue(null);

    await expect(clearDynamicDataForCustomer(new ObjectId())).resolves.toBeNull();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});