import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPermissions } from "./contracts";
import { legacyCompanyId } from "../companies/ownership";

const mocks = vi.hoisted(() => ({ user: vi.fn(), company: vi.fn() }));
vi.mock("../mongodb", () => ({
  getMongoClient: async () => ({ db: () => ({ collection: (name: string) => ({ findOne: name === "users" ? mocks.user : mocks.company }) }) }),
}));
import { loadIdentity, resolveToken, sessionFingerprint } from "./session";
import type { UserDocument } from "../users";

const id = new ObjectId();
let user: UserDocument;
const secret = "test-secret";
beforeEach(() => {
  user = {
    _id: id, companyId: legacyCompanyId(), name: "Test", email: "test@example.com", passwordHash: "hash-original",
    sessionVersion: 1, disabled: false, permissions: emptyPermissions(), createdAt: new Date(), updatedAt: new Date(),
  };
  mocks.user.mockImplementation(async () => user);
  mocks.company.mockResolvedValue({
    _id: legacyCompanyId(), name: "Company", status: "active", isolationReady: false, accessControlVersion: 1, adminUserId: id,
  });
});

describe("database-validated sessions", () => {
  it("resolves company/admin identity only from the database", async () => {
    const principal = await resolveToken({ id: id.toHexString(), accessFingerprint: sessionFingerprint(user, secret) }, secret);
    expect(principal).toMatchObject({ id: id.toHexString(), companyId: legacyCompanyId().toHexString(), isAdmin: true });
    expect(principal).not.toHaveProperty("passwordHash");
  });
  it.each(["passwordHash", "email", "sessionVersion", "disabled", "companyId", "permissions"] as const)(
    "invalidates the existing session after a direct %s change", async field => {
      const token = { id: id.toHexString(), accessFingerprint: sessionFingerprint(user, secret) };
      if (field === "passwordHash") user.passwordHash = "changed-directly-in-db";
      if (field === "email") user.email = "changed@example.com";
      if (field === "sessionVersion") user.sessionVersion = 2;
      if (field === "disabled") user.disabled = true;
      if (field === "companyId") user.companyId = new ObjectId();
      if (field === "permissions") user.permissions = { ...emptyPermissions(), calendar: "read" };
      expect(await resolveToken(token, secret)).toBeNull();
    },
  );
  it("rejects old JWTs without a fingerprint and deleted users", async () => {
    expect(await resolveToken({ id: id.toHexString() }, secret)).toBeNull();
    mocks.user.mockResolvedValue(null);
    expect(await loadIdentity(id.toHexString())).toBeNull();
  });
  it("fails closed when the company is uninitialized or inactive", async () => {
    mocks.company.mockResolvedValue({ status: "active" });
    expect(await loadIdentity(id.toHexString())).toBeNull();
    mocks.company.mockResolvedValue(null);
    expect(await loadIdentity(id.toHexString())).toBeNull();
  });
});
