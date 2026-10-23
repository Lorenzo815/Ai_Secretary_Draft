import { BSON, ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";
import { assertCompany } from "../companies/migration-safety";
import { emptyPermissions } from "./contracts";

const mocks = vi.hoisted(() => ({
  companies: { findOne: vi.fn(), updateOne: vi.fn() },
  users: { findOne: vi.fn(), find: vi.fn(), updateOne: vi.fn() },
  session: { withTransaction: vi.fn(), endSession: vi.fn() },
}));
vi.mock("../mongodb", () => ({ default: Promise.resolve({
  startSession: () => mocks.session,
  db: () => ({ collection: (name: string) => name === "users" ? mocks.users : mocks.companies }),
}) }));
import clientPromise from "../mongodb";
import { bootstrapUserAccess } from "./management";

const adminId = new ObjectId();
const company = {
  _id: legacyCompanyId(), name: "Company", key: "legacy", status: "active", isolationReady: false, createdAt: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.withTransaction.mockImplementation((run: () => Promise<unknown>) => run());
  mocks.companies.findOne.mockResolvedValue(company);
  mocks.users.find.mockReturnValue({ toArray: async () => [{ _id: adminId, passwordHash: "unchanged-hash", email: "unchanged@example.com" }] });
});

describe("explicit existing-admin bootstrap", () => {
  it("only adds access metadata and never changes existing credentials or timestamps", async () => {
    expect(await bootstrapUserAccess(await clientPromise, legacyCompanyId(), adminId)).toBe(true);
    expect(mocks.users.updateOne).toHaveBeenCalledWith(
      { _id: adminId, companyId: legacyCompanyId() },
      { $set: { permissions: emptyPermissions(), disabled: false, sessionVersion: 1 } },
      { session: mocks.session },
    );
    expect(mocks.companies.updateOne).toHaveBeenCalledWith(
      { _id: legacyCompanyId(), accessControlVersion: { $exists: false } },
      { $set: { adminUserId: adminId, accessControlVersion: 1, userManagementVersion: 0 } },
      { session: mocks.session },
    );
  });
  it("is idempotent for an initialized, valid admin", async () => {
    mocks.companies.findOne.mockResolvedValue({ ...company, accessControlVersion: 1, adminUserId: adminId });
    mocks.users.findOne.mockResolvedValue({ disabled: false, sessionVersion: 1, permissions: emptyPermissions() });
    expect(await bootstrapUserAccess(await clientPromise, legacyCompanyId(), adminId)).toBe(false);
    expect(mocks.users.updateOne).not.toHaveBeenCalled();
  });
  it("refuses ambiguous users instead of promoting one automatically", async () => {
    mocks.users.find.mockReturnValue({ toArray: async () => [{ _id: adminId }, { _id: new ObjectId() }] });
    await expect(bootstrapUserAccess(await clientPromise, legacyCompanyId(), adminId)).rejects.toThrow();
    expect(mocks.companies.updateOne).not.toHaveBeenCalled();
  });
  it("refuses to overwrite an existing administrator", async () => {
    mocks.companies.findOne.mockResolvedValue({ ...company, accessControlVersion: 1, adminUserId: new ObjectId() });
    await expect(bootstrapUserAccess(await clientPromise, legacyCompanyId(), adminId)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps recovery tooling compatible with exact BSON access metadata", () => {
    const initialized = { ...company, adminUserId: adminId, accessControlVersion: 1, userManagementVersion: 0 };
    expect(() => assertCompany(BSON.deserialize(BSON.serialize(initialized), { promoteValues: false }))).not.toThrow();
    expect(() => assertCompany({ ...initialized, accessControlVersion: true })).toThrow();
    expect(() => assertCompany({ ...initialized, userManagementVersion: -1 })).toThrow();
    expect(() => assertCompany({ ...initialized, unknownField: "no" })).toThrow();
  });
});
