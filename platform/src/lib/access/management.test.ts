import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPermissions, type Principal } from "./contracts";
import { legacyCompanyId } from "../companies/ownership";

const mocks = vi.hoisted(() => {
  const users = { findOne: vi.fn(), countDocuments: vi.fn(), insertOne: vi.fn(), updateOne: vi.fn(), updateMany: vi.fn(), deleteOne: vi.fn() };
  const companies = { findOneAndUpdate: vi.fn(), updateOne: vi.fn() };
  const session = { withTransaction: vi.fn(), endSession: vi.fn() };
  return { users, companies, session, compare: vi.fn(), hash: vi.fn() };
});
vi.mock("bcryptjs", () => ({ compare: mocks.compare, hash: mocks.hash }));
vi.mock("../mongodb", () => ({ default: Promise.resolve({
  startSession: () => mocks.session,
  db: () => ({ collection: (name: string) => name === "users" ? mocks.users : mocks.companies }),
}) }));
import { createManagedUser, deleteManagedUser, updateManagedUser, transferAdmin, updateCompanyProfile, validateCnpj, validatePassword } from "./management";

const adminId = new ObjectId();
const targetId = new ObjectId();
const principal: Principal = {
  id: adminId.toHexString(), companyId: legacyCompanyId().toHexString(), companyName: "Company",
  email: "admin@example.com", name: "Admin", isAdmin: true, permissions: emptyPermissions(),
};
let count: number;
const input = { name: "Test user", email: "USER@example.com", password: "secure-password-test" };

beforeEach(() => {
  vi.clearAllMocks();
  count = 1;
  let queue = Promise.resolve();
  mocks.session.withTransaction.mockImplementation((run: () => Promise<unknown>) => {
    const result = queue.then(run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  });
  mocks.users.findOne.mockImplementation(async (filter: { _id: ObjectId }) => ({
    _id: filter._id, companyId: legacyCompanyId(), passwordHash: "current-hash", disabled: false,
  }));
  mocks.companies.findOneAndUpdate.mockResolvedValue({ _id: legacyCompanyId(), adminUserId: adminId });
  mocks.users.countDocuments.mockImplementation(async () => count);
  mocks.users.insertOne.mockImplementation(async () => { count++; return { insertedId: targetId }; });
  mocks.hash.mockResolvedValue("new-bcrypt-hash");
  mocks.compare.mockResolvedValue(true);
  mocks.users.deleteOne.mockResolvedValue({ deletedCount: 1 });
});

describe("company administration invariants", () => {
  it("creates account 25 with no permissions and a hashed password", async () => {
    count = 24;
    await createManagedUser(principal, input);
    expect(count).toBe(25);
    expect(mocks.users.countDocuments).toHaveBeenCalledWith({ companyId: legacyCompanyId() }, { session: mocks.session });
    expect(mocks.users.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      companyId: legacyCompanyId(), name: input.name, email: "user@example.com",
      passwordHash: "new-bcrypt-hash", sessionVersion: 1, disabled: false, permissions: emptyPermissions(),
    }), { session: mocks.session });
    expect(mocks.hash).toHaveBeenCalledWith(input.password, 12);
  });
  it("rejects account 26 and serializes concurrent creation through a company write lock", async () => {
    count = 24;
    const results = await Promise.allSettled([createManagedUser(principal, input), createManagedUser(principal, input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(count).toBe(25);
    expect(mocks.companies.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: legacyCompanyId(), adminUserId: adminId, status: "active", accessControlVersion: 1 },
      { $inc: { userManagementVersion: 1 } }, { session: mocks.session, returnDocument: "after" },
    );
    expect(mocks.session.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
    });
  });
  it("revalidates the sole admin inside the transaction instead of trusting the session role", async () => {
    mocks.companies.findOneAndUpdate.mockResolvedValue(null);
    await expect(createManagedUser(principal, input)).rejects.toMatchObject({ status: 403 });
    expect(mocks.users.insertOne).not.toHaveBeenCalled();
  });
  it("rejects another company and absent/foreign users", async () => {
    await expect(createManagedUser({ ...principal, companyId: new ObjectId().toHexString() }, input)).rejects.toMatchObject({ status: 403 });
    mocks.users.findOne.mockResolvedValueOnce({ _id: adminId }).mockResolvedValueOnce(null);
    await expect(updateManagedUser(principal, { ...input, id: targetId.toHexString(), permissions: emptyPermissions(), disabled: false })).rejects.toMatchObject({ status: 404 });
  });
  it("does not allow the sole administrator to be deactivated", async () => {
    await expect(updateManagedUser(principal, {
      ...input, id: adminId.toHexString(), permissions: emptyPermissions(), disabled: true,
    })).rejects.toMatchObject({ status: 409 });
    expect(mocks.users.updateOne).not.toHaveBeenCalled();
  });
  it("invalidates sessions on changes without persisting a plaintext password", async () => {
    await updateManagedUser(principal, {
      ...input, id: targetId.toHexString(), permissions: emptyPermissions(), disabled: true,
    });
    expect(mocks.users.updateOne).toHaveBeenCalledWith(
      { _id: targetId, companyId: legacyCompanyId() },
      { $set: expect.objectContaining({ passwordHash: "new-bcrypt-hash", disabled: true }), $inc: { sessionVersion: 1 } },
      { session: mocks.session },
    );
  });
  it("transfers the single admin pointer atomically and revokes both accounts", async () => {
    await transferAdmin(principal, { userId: targetId.toHexString(), currentPassword: "current-password" });
    expect(mocks.compare).toHaveBeenCalledWith("current-password", "current-hash");
    expect(mocks.companies.updateOne).toHaveBeenCalledWith(
      { _id: legacyCompanyId(), adminUserId: adminId },
      { $set: { adminUserId: targetId } }, { session: mocks.session },
    );
    expect(mocks.users.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [adminId, targetId] }, companyId: legacyCompanyId() },
      { $inc: { sessionVersion: 1 }, $set: { updatedAt: expect.any(Date) } }, { session: mocks.session },
    );
  });
  it("does not transfer admin on an incorrect current password", async () => {
    mocks.compare.mockResolvedValue(false);
    await expect(transferAdmin(principal, { userId: targetId.toHexString(), currentPassword: "wrong" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.companies.updateOne).not.toHaveBeenCalled();
  });
  it("only saves allowed company profile fields", async () => {
    await updateCompanyProfile(principal, {
      name: "Company", legalName: "", cnpj: "", contactEmail: "", contactPhone: "", adminUserId: targetId.toHexString(),
    });
    expect(mocks.companies.updateOne).toHaveBeenCalledWith({ _id: legacyCompanyId() }, {
      $set: { name: "Company", legalName: "", cnpj: "", contactEmail: "", contactPhone: "" },
    }, { session: mocks.session });
  });
  it("only deletes the selected company's login account after confirmation", async () => {
    await deleteManagedUser(principal, { id: targetId.toHexString(), confirmation: "EXCLUIR" });
    expect(mocks.users.deleteOne).toHaveBeenCalledExactlyOnceWith(
      { _id: targetId, companyId: legacyCompanyId() }, { session: mocks.session },
    );
    expect(mocks.users.updateMany).not.toHaveBeenCalled();
  });
  it("never deletes the sole admin or accepts an unconfirmed deletion", async () => {
    await expect(deleteManagedUser(principal, { id: adminId.toHexString(), confirmation: "EXCLUIR" })).rejects.toMatchObject({ status: 409 });
    await expect(deleteManagedUser(principal, { id: targetId.toHexString() })).rejects.toThrow();
    expect(mocks.users.deleteOne).not.toHaveBeenCalled();
  });
  it("returns not found for another company's user instead of deleting it", async () => {
    mocks.users.deleteOne.mockResolvedValue({ deletedCount: 0 });
    await expect(deleteManagedUser(principal, { id: targetId.toHexString(), confirmation: "EXCLUIR" })).rejects.toMatchObject({ status: 404 });
  });
  it("frees a slot at the 25-account limit after deleting an account", async () => {
    count = 25;
    await expect(createManagedUser(principal, input)).rejects.toMatchObject({ status: 409 });
    mocks.users.deleteOne.mockImplementationOnce(async () => { count--; return { deletedCount: 1 }; });
    await deleteManagedUser(principal, { id: targetId.toHexString(), confirmation: "EXCLUIR" });
    await createManagedUser(principal, input);
    expect(count).toBe(25);
  });
  it("validates passwords at bcrypt's exact byte limit and CNPJ check digits", () => {
    expect(() => validatePassword("short")).toThrow();
    expect(() => validatePassword("a".repeat(73))).toThrow();
    expect(() => validatePassword("é".repeat(37))).toThrow();
    expect(validatePassword("a".repeat(72))).toHaveLength(72);
    expect(validateCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(() => validateCnpj("11.222.333/0001-80")).toThrow();
  });
});
