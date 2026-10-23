import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import type { UserDocument } from "../users";
import { LEGACY_COMPANY_ID } from "../companies/ownership";
import { parsePermissions, type Principal } from "./contracts";

export interface AccessCompany {
  _id: ObjectId;
  name: string;
  status: "active";
  isolationReady: false;
  createdAt: Date;
  adminUserId?: ObjectId;
  accessControlVersion?: number;
  userManagementVersion?: number;
  legalName?: string;
  cnpj?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export function sessionFingerprint(user: UserDocument, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify([
    "company-session-v1", user._id.toHexString(), user.companyId.toHexString(),
    user.email, user.passwordHash, user.sessionVersion, user.disabled,
    user.permissions,
  ])).digest("hex");
}

export function equalFingerprint(left: unknown, right: string) {
  return typeof left === "string" && /^[a-f0-9]{64}$/.test(left) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function loadIdentity(id: unknown) {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) return null;
  const db = (await clientPromise).db("ai_secretary");
  const user = await db.collection<UserDocument>("users").findOne({ _id: new ObjectId(id) });
  if (!user || user.disabled !== false || !Number.isSafeInteger(user.sessionVersion) ||
    !(user.companyId instanceof ObjectId) || user.companyId.toHexString() !== LEGACY_COMPANY_ID) return null;
  const company = await db.collection<AccessCompany>("companies").findOne({ _id: user.companyId });
  if (!company || company.status !== "active" || company.isolationReady !== false || company.accessControlVersion !== 1 ||
    !(company.adminUserId instanceof ObjectId)) return null;
  let permissions;
  try {
    permissions = parsePermissions(user.permissions);
  } catch {
    console.error("Access rejected: invalid stored user permissions.", { userId: id });
    return null;
  }
  const principal: Principal = {
    id: user._id.toHexString(), companyId: user.companyId.toHexString(), companyName: company.name,
    email: user.email, name: user.name,
    isAdmin: company.adminUserId.equals(user._id), permissions,
  };
  return { user, company, principal };
}

export async function resolveToken(token: { id?: unknown; accessFingerprint?: unknown } | null, secret: string) {
  if (!token) return null;
  const identity = await loadIdentity(token.id);
  if (!identity || !equalFingerprint(token.accessFingerprint, sessionFingerprint(identity.user, secret))) return null;
  return identity.principal;
}
