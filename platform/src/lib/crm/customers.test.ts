import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { collection, findOne, findOneAndUpdate } = vi.hoisted(() => ({
  collection: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
}));

import { updateCustomerProfile } from "./customers";

describe("updateCustomerProfile address updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ findOne, findOneAndUpdate });
  });

  afterEach(() => vi.restoreAllMocks());

  it("does not resolve an unchanged postal code again", async () => {
    const customerId = new ObjectId();
    const customer = {
      _id: customerId,
      phones: ["5511999999999"],
      profile: {
        address: {
          postalCode: "12345-678",
          street: "Rua existente",
          neighborhood: "Bairro existente",
          city: "Cidade existente",
          state: "SP",
        },
        updatedAt: new Date(),
      },
    };
    findOne.mockResolvedValue(customer);
    findOneAndUpdate.mockResolvedValue({
      ...customer,
      profile: { ...customer.profile, address: { ...customer.profile.address, number: "123" } },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await updateCustomerProfile(customerId, {
      postalCode: "12345-678",
      addressNumber: "123",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: customerId },
      expect.objectContaining({
        $set: expect.objectContaining({ "profile.address.number": "123" }),
      }),
      { returnDocument: "after" },
    );
  });
});