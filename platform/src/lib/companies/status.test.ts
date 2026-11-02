import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOne } = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock("../mongodb", () => ({
  getMongoClient: async () => ({ db: () => ({ collection: () => ({ findOne }) }) }),
}));

import { legacyCompanyId } from "./ownership";
import { isCompanyOperational } from "./status";

beforeEach(() => findOne.mockReset());

describe("company operational status", () => {
  it("keeps the original clinic operational while active, as today", async () => {
    findOne.mockResolvedValue({ status: "active" });
    await expect(isCompanyOperational(legacyCompanyId())).resolves.toBe(true);
    findOne.mockResolvedValue({ status: "suspended" });
    await expect(isCompanyOperational(legacyCompanyId())).resolves.toBe(false);
  });

  it("requires any other company to be explicitly marked isolation-ready", async () => {
    const companyId = new ObjectId();
    findOne.mockResolvedValue({ status: "active" });
    await expect(isCompanyOperational(companyId)).resolves.toBe(false);
    findOne.mockResolvedValue({ status: "test", isolationReady: false });
    await expect(isCompanyOperational(companyId)).resolves.toBe(false);
    findOne.mockResolvedValue({ status: "test", isolationReady: true });
    await expect(isCompanyOperational(companyId)).resolves.toBe(true);
    findOne.mockResolvedValue({ status: "suspended", isolationReady: true });
    await expect(isCompanyOperational(companyId)).resolves.toBe(false);
  });

  it("treats an unknown company as not operational", async () => {
    findOne.mockResolvedValue(null);
    await expect(isCompanyOperational(new ObjectId())).resolves.toBe(false);
  });
});
