import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { collection, deleteMany, findOne } = vi.hoisted(() => ({
  collection: vi.fn(),
  deleteMany: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection }),
  }),
}));

import { clearDynamicDataForCustomer, DYNAMIC_COLLECTIONS } from "./database";

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