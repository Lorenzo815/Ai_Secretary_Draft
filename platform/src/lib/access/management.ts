import { compare, hash } from "bcryptjs";
import { MongoServerError, ObjectId, type ClientSession, type Db, type MongoClient } from "mongodb";
import clientPromise from "../mongodb";
import type { UserDocument } from "../users";
import { LEGACY_COMPANY_ID } from "../companies/ownership";
import { emptyPermissions, parsePermissions, USER_LIMIT, type CompanySettings, type Principal } from "./contracts";
import type { AccessCompany } from "./session";

export class ManagementError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function objectId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value)) throw new ManagementError("Identificador inválido.");
  return new ObjectId(value);
}

function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new ManagementError(`${label} inválido.`);
  return value.trim();
}

function email(value: unknown) {
  const result = text(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ManagementError("Email inválido.");
  return result;
}

export function validatePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || Buffer.byteLength(value, "utf8") > 72) {
    throw new ManagementError("A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.");
  }
  return value;
}

export function validateCnpj(value: unknown) {
  const normalized = text(value, "CNPJ", 18, false).replace(/[./-]/g, "");
  if (!normalized) return "";
  if (!/^\d{14}$/.test(normalized) || /^(\d)\1+$/.test(normalized)) throw new ManagementError("CNPJ inválido.");
  for (const size of [12, 13]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(normalized[i]) * ((size - i - 1) % 8 + 2);
    const digit = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (digit !== Number(normalized[size])) throw new ManagementError("CNPJ inválido.");
  }
  return normalized;
}

function scopedCompany(principal: Principal) {
  if (principal.companyId !== LEGACY_COMPANY_ID) throw new ManagementError("Empresa não habilitada.", 403);
  return objectId(principal.companyId);
}

export async function adminTransaction<T>(
  principal: Principal,
  run: (db: Db, session: ClientSession, company: AccessCompany) => Promise<T>,
) {
  const client = await clientPromise;
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const db = client.db("ai_secretary");
      const companyId = scopedCompany(principal);
      const actor = await db.collection<UserDocument>("users").findOne(
        { _id: objectId(principal.id), companyId, disabled: false }, { session },
      );
      if (!actor) throw new ManagementError("Sessão inválida.", 401);
      const company = await db.collection<AccessCompany>("companies").findOneAndUpdate(
        { _id: companyId, adminUserId: actor._id, status: "active", accessControlVersion: 1 },
        { $inc: { userManagementVersion: 1 } }, { session, returnDocument: "after" },
      );
      if (!company) throw new ManagementError("Somente o administrador da empresa pode executar esta operação.", 403);
      return run(db, session, company);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally { await session.endSession(); }
}

export async function getCompanySettings(principal: Principal): Promise<CompanySettings> {
  const db = (await clientPromise).db("ai_secretary");
  const companyId = scopedCompany(principal);
  const company = await db.collection<AccessCompany>("companies").findOne({ _id: companyId, status: "active", accessControlVersion: 1 });
  if (!company?.adminUserId) throw new ManagementError("Empresa indisponível.", 403);
  const admin = await db.collection<UserDocument>("users").findOne(
    { _id: company.adminUserId, companyId, disabled: false }, { projection: { name: 1, email: 1 } },
  );
  if (!admin) throw new ManagementError("Administrador da empresa indisponível.", 409);
  const isAdmin = company.adminUserId.toHexString() === principal.id;
  const users = isAdmin ? await db.collection<UserDocument>("users").find(
    { companyId }, { projection: { passwordHash: 0 } },
  ).sort({ createdAt: 1, _id: 1 }).toArray() : [];
  return {
    company: {
      id: company._id.toHexString(), name: company.name, legalName: company.legalName ?? "",
      cnpj: company.cnpj ?? "", contactEmail: company.contactEmail ?? "", contactPhone: company.contactPhone ?? "",
      status: company.status, createdAt: company.createdAt.toISOString(), adminUserId: company.adminUserId.toHexString(),
      adminName: admin.name, adminEmail: admin.email,
    },
    users: users.map(user => ({
      id: user._id.toHexString(), name: user.name, email: user.email,
      disabled: user.disabled === true, isAdmin: company.adminUserId!.equals(user._id),
      permissions: parsePermissions(user.permissions),
    })),
    userLimit: USER_LIMIT,
  };
}

export async function createManagedUser(principal: Principal, input: Record<string, unknown>) {
  const name = text(input.name, "Nome", 120);
  const normalizedEmail = email(input.email);
  const passwordHash = await hash(validatePassword(input.password), 12);
  const permissions = input.permissions === undefined ? emptyPermissions() : parsePermissions(input.permissions);
  try {
    await adminTransaction(principal, async (db, session, company) => {
      const users = db.collection<UserDocument>("users");
      if (await users.countDocuments({ companyId: company._id }, { session }) >= USER_LIMIT) {
        throw new ManagementError("Limite de 25 contas atingido, incluindo o administrador e contas desativadas.", 409);
      }
      const now = new Date();
      await users.insertOne({
        _id: new ObjectId(), companyId: company._id, name, email: normalizedEmail,
        passwordHash, permissions, disabled: false, sessionVersion: 1, createdAt: now, updatedAt: now,
      }, { session });
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) throw new ManagementError("Este email já está em uso.", 409);
    throw error;
  }
}

export async function updateManagedUser(principal: Principal, input: Record<string, unknown>) {
  const id = objectId(input.id);
  const name = text(input.name, "Nome", 120);
  const normalizedEmail = email(input.email);
  const permissions = parsePermissions(input.permissions);
  if (typeof input.disabled !== "boolean") throw new ManagementError("Estado da conta inválido.");
  const disabled = input.disabled;
  const passwordHash = input.password === undefined || input.password === ""
    ? undefined : await hash(validatePassword(input.password), 12);
  try {
    await adminTransaction(principal, async (db, session, company) => {
      const users = db.collection<UserDocument>("users");
      const existing = await users.findOne({ _id: id, companyId: company._id }, { session });
      if (!existing) throw new ManagementError("Usuário não encontrado.", 404);
      if (company.adminUserId!.equals(id) && disabled) throw new ManagementError("Transfira a administração antes de desativar esta conta.", 409);
      await users.updateOne({ _id: id, companyId: company._id }, {
        $set: { name, email: normalizedEmail, permissions, disabled, ...(passwordHash ? { passwordHash } : {}), updatedAt: new Date() },
        $inc: { sessionVersion: 1 },
      }, { session });
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) throw new ManagementError("Este email já está em uso.", 409);
    throw error;
  }
}

export async function transferAdmin(principal: Principal, input: Record<string, unknown>) {
  const targetId = objectId(input.userId);
  if (targetId.toHexString() === principal.id) throw new ManagementError("Selecione outro usuário ativo.");
  if (typeof input.currentPassword !== "string" || !input.currentPassword || input.currentPassword.length > 1000) {
    throw new ManagementError("Senha atual inválida.");
  }
  const password = input.currentPassword;
  await adminTransaction(principal, async (db, session, company) => {
    const users = db.collection<UserDocument>("users");
    const actor = await users.findOne({ _id: objectId(principal.id), companyId: company._id, disabled: false }, { session });
    if (!actor || !await compare(password, actor.passwordHash)) throw new ManagementError("Senha atual incorreta.", 403);
    const target = await users.findOne({ _id: targetId, companyId: company._id, disabled: false }, { session });
    if (!target) throw new ManagementError("Selecione um usuário ativo desta empresa.", 404);
    await db.collection<AccessCompany>("companies").updateOne(
      { _id: company._id, adminUserId: actor._id }, { $set: { adminUserId: targetId } }, { session },
    );
    await users.updateMany({ _id: { $in: [actor._id, targetId] }, companyId: company._id }, {
      $inc: { sessionVersion: 1 }, $set: { updatedAt: new Date() },
    }, { session });
  });
}

export async function deleteManagedUser(principal: Principal, input: Record<string, unknown>) {
  const id = objectId(input.id);
  if (input.confirmation !== "EXCLUIR") throw new ManagementError("Confirme a exclusão da conta.");
  await adminTransaction(principal, async (db, session, company) => {
    if (company.adminUserId!.equals(id)) throw new ManagementError("O administrador não pode ser excluído. Transfira a administração primeiro.", 409);
    const result = await db.collection<UserDocument>("users").deleteOne({ _id: id, companyId: company._id }, { session });
    if (result.deletedCount !== 1) throw new ManagementError("Usuário não encontrado.", 404);
  });
}

export async function updateCompanyProfile(principal: Principal, input: Record<string, unknown>) {
  const profile = {
    name: text(input.name, "Nome da empresa", 160),
    legalName: text(input.legalName, "Razão social", 200, false),
    cnpj: validateCnpj(input.cnpj),
    contactEmail: input.contactEmail === "" ? "" : email(input.contactEmail),
    contactPhone: text(input.contactPhone, "Telefone", 30, false),
  };
  if (profile.contactPhone && !/^[+\d()\s-]{6,30}$/.test(profile.contactPhone)) throw new ManagementError("Telefone inválido.");
  await adminTransaction(principal, async (db, session, company) => {
    await db.collection<AccessCompany>("companies").updateOne({ _id: company._id }, { $set: profile }, { session });
  });
}

export async function bootstrapUserAccess(client: MongoClient, companyId: ObjectId, adminId: ObjectId) {
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const db = client.db("ai_secretary");
      const companies = db.collection<AccessCompany>("companies");
      const users = db.collection<UserDocument>("users");
      const company = await companies.findOne({ _id: companyId, status: "active", isolationReady: false }, { session });
      if (!company || companyId.toHexString() !== LEGACY_COMPANY_ID) throw new ManagementError("Empresa inicial inválida.");
      if (company.accessControlVersion === 1) {
        if (!company.adminUserId?.equals(adminId)) throw new ManagementError("Administrador já configurado.", 409);
        const admin = await users.findOne({ _id: adminId, companyId, disabled: false }, { session });
        if (!admin || !Number.isSafeInteger(admin.sessionVersion)) throw new ManagementError("Administrador configurado está inválido.");
        parsePermissions(admin.permissions);
        return false;
      }
      const all = await users.find({ companyId }, { session }).toArray();
      if (all.length !== 1 || !all[0]._id.equals(adminId) || company.adminUserId || company.accessControlVersion !== undefined) {
        throw new ManagementError("Bootstrap requer exatamente o usuário existente, sem administração prévia.");
      }
      const user = all[0];
      if (["permissions", "disabled", "sessionVersion"].some(key => Object.hasOwn(user, key))) throw new ManagementError("Metadados de acesso já existem; revisão manual necessária.");
      await users.updateOne({ _id: adminId, companyId }, { $set: { permissions: emptyPermissions(), disabled: false, sessionVersion: 1 } }, { session });
      await companies.updateOne({ _id: companyId, accessControlVersion: { $exists: false } }, {
        $set: { adminUserId: adminId, accessControlVersion: 1, userManagementVersion: 0 },
      }, { session });
      return true;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally { await session.endSession(); }
}
