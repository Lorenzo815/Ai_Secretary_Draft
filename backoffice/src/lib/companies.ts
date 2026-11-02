import "server-only";

import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { ObjectId, type Document } from "mongodb";
import { audit } from "./audit";
import { parseEjsonObject, toEjson } from "./actions";
import { encryptWhatsAppToken } from "./crypto";
import { maskDocument } from "./masking";
import { getClient, getDb, DB_NAME } from "./mongodb";
import {
  COMPANY_STATUSES, DEFAULT_GRAPH_VERSION, LEGACY_COMPANY_ID, USER_LIMIT,
  companyScopedId, emptyPermissions, parsePermissions, type CompanyStatus, type Permissions,
} from "./platform-rules";
import { assertConfirmed, requiredConfirmation } from "./risk";

export interface CompanyRecord {
  _id: ObjectId;
  key?: string;
  name: string;
  status: CompanyStatus;
  isolationReady: boolean;
  createdAt: Date;
  adminUserId?: ObjectId;
  accessControlVersion?: number;
  userManagementVersion?: number;
  legalName?: string;
  cnpj?: string;
  contactEmail?: string;
  contactPhone?: string;
}

interface UserRecord {
  _id: ObjectId;
  companyId: ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  permissions?: Permissions;
  disabled?: boolean;
  sessionVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ConnectionRecord {
  _id: string;
  companyId?: ObjectId;
  appId: string;
  graphVersion: string;
  accessToken: unknown;
  status: "token_exchanged" | "connected" | "operational" | "disconnected";
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  label?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DAY = 24 * 60 * 60 * 1000;

// ---------- validation (same limits as the platform) ----------

function text(value: unknown, label: string, max: number, required = true) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${label} é obrigatório.`);
  if (normalized.length > max) throw new Error(`${label} deve ter no máximo ${max} caracteres.`);
  return normalized;
}

function email(value: unknown) {
  const normalized = text(value, "E-mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("E-mail inválido.");
  return normalized;
}

export function validatePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || Buffer.byteLength(value, "utf8") > 72) {
    throw new Error("A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.");
  }
  return value;
}

export function validateCnpj(value: unknown) {
  const normalized = text(value, "CNPJ", 18, false).replace(/[./-]/g, "");
  if (!normalized) return "";
  if (!/^\d{14}$/.test(normalized) || /^(\d)\1{13}$/.test(normalized)) throw new Error("CNPJ inválido.");
  for (const size of [12, 13]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(normalized[i]) * ((size - i - 1) % 8 + 2);
    const digit = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (digit !== Number(normalized[size])) throw new Error("CNPJ inválido.");
  }
  return normalized;
}

function status(value: unknown): CompanyStatus {
  if (!COMPANY_STATUSES.includes(value as CompanyStatus)) throw new Error("Status inválido.");
  return value as CompanyStatus;
}

function objectId(value: unknown, label = "Identificador") {
  if (typeof value !== "string" || !ObjectId.isValid(value) || !/^[a-f0-9]{24}$/i.test(value)) throw new Error(`${label} inválido.`);
  return new ObjectId(value);
}

function slug(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base.slice(0, 40) || "clinica"}-${randomUUID().slice(0, 6)}`;
}

function productionPhrase(companyId: ObjectId) {
  return requiredConfirmation({ operation: "update", collection: "companies", touchesProduction: companyId.toHexString() === LEGACY_COMPANY_ID });
}

async function requireCompany(companyId: ObjectId) {
  const company = await (await getDb()).collection<CompanyRecord>("companies").findOne({ _id: companyId });
  if (!company) throw new Error("Empresa não encontrada.");
  return company;
}

// ---------- reads ----------

async function countByCompany(collection: string, match: Document = {}) {
  const rows = await (await getDb()).collection(collection)
    .aggregate<{ _id: ObjectId | null; n: number }>([{ $match: match }, { $group: { _id: "$companyId", n: { $sum: 1 } } }]).toArray();
  return new Map(rows.map((row) => [String(row._id), row.n]));
}

export async function listCompanyOverview() {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * DAY);
  const [companies, users, customers, messages, runs, phones] = await Promise.all([
    db.collection<CompanyRecord>("companies").find({}).sort({ createdAt: 1 }).toArray(),
    countByCompany("users"),
    countByCompany("crm_customers"),
    countByCompany("whatsapp_messages", { timestamp: { $gte: since } }),
    countByCompany("assistant_runs", { startedAt: { $gte: since } }),
    db.collection<ConnectionRecord>("whatsapp_embedded_signup_connections")
      .find({ status: "operational" }, { projection: { companyId: 1, phoneNumberId: 1, displayPhoneNumber: 1 } }).toArray(),
  ]);
  return companies.map((company) => {
    const id = company._id.toHexString();
    const phone = phones.find((connection) => String(connection.companyId) === id);
    return {
      id, name: company.name, status: company.status, isolationReady: company.isolationReady === true,
      legacy: id === LEGACY_COMPANY_ID, createdAt: company.createdAt,
      users: users.get(id) ?? 0, customers: customers.get(id) ?? 0,
      messages30d: messages.get(id) ?? 0, runs30d: runs.get(id) ?? 0,
      phone: phone ? (phone.displayPhoneNumber ?? phone.phoneNumberId ?? "") : id === LEGACY_COMPANY_ID ? "número do ambiente" : "",
    };
  });
}

export async function getCompanyDetail(companyIdText: string) {
  const companyId = objectId(companyIdText, "Empresa");
  const db = await getDb();
  const company = await requireCompany(companyId);
  const [users, connections, aiConfig, collections] = await Promise.all([
    db.collection<UserRecord>("users").find({ companyId }, { projection: { passwordHash: 0 } }).sort({ createdAt: 1 }).toArray(),
    db.collection<ConnectionRecord>("whatsapp_embedded_signup_connections").find({ companyId }).sort({ createdAt: -1 }).toArray(),
    db.collection("ai_model_config").findOne({ _id: companyScopedId(companyIdText, "active") as never }),
    db.listCollections({}, { nameOnly: true }).toArray(),
  ]);
  const counts = await Promise.all(collections
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith("system.") && name !== "companies")
    .sort()
    .map(async (name) => ({ name, count: await db.collection(name).countDocuments({ companyId }) })));
  return {
    company,
    users: users.map((user) => ({ ...user, permissions: parsePermissions(user.permissions) })),
    connections: connections.map((connection) => maskDocument(connection)),
    aiConfig,
    aiConfigJson: aiConfig ? toEjson({ activeProvider: aiConfig.activeProvider, tasks: aiConfig.tasks, audioTranscription: aiConfig.audioTranscription }) : "",
    counts: counts.filter((entry) => entry.count > 0),
  };
}

// ---------- companies ----------

export async function createCompany(actor: string, input: Record<string, unknown>) {
  const name = text(input.name, "Nome da clínica", 160);
  const profile = {
    legalName: text(input.legalName, "Razão social", 200, false),
    cnpj: validateCnpj(input.cnpj),
    contactEmail: input.contactEmail ? email(input.contactEmail) : "",
    contactPhone: text(input.contactPhone, "Telefone", 30, false),
  };
  const companyStatus = status(input.status ?? "test");
  const isolationReady = input.isolationReady === true;
  const adminName = text(input.adminName, "Nome do administrador", 120);
  const adminEmail = email(input.adminEmail);
  const passwordHash = await hash(validatePassword(input.adminPassword), 12);
  const now = new Date();
  const companyId = new ObjectId();
  const adminId = new ObjectId();
  const company: CompanyRecord = {
    _id: companyId, key: slug(name), name, status: companyStatus, isolationReady, createdAt: now,
    adminUserId: adminId, accessControlVersion: 1, userManagementVersion: 0, ...profile,
  };
  const admin: UserRecord = {
    _id: adminId, companyId, name: adminName, email: adminEmail, passwordHash,
    permissions: emptyPermissions(), disabled: false, sessionVersion: 1, createdAt: now, updatedAt: now,
  };
  const session = (await getClient()).startSession();
  try {
    await session.withTransaction(async () => {
      const db = (await getClient()).db(DB_NAME);
      if (await db.collection("users").findOne({ email: adminEmail }, { session, projection: { _id: 1 } })) {
        throw new Error("Este e-mail já é usado por outra conta.");
      }
      await db.collection<CompanyRecord>("companies").insertOne(company, { session });
      await db.collection<UserRecord>("users").insertOne(admin, { session });
    });
  } finally {
    await session.endSession();
  }
  await audit({ actor, action: "company.create", collection: "companies", documentId: companyId, companyId: companyId.toHexString(), after: { company, admin } });
  return companyId.toHexString();
}

export async function updateCompany(actor: string, companyIdText: string, input: Record<string, unknown>, confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  const before = await requireCompany(companyId);
  const next = {
    name: text(input.name, "Nome da clínica", 160),
    legalName: text(input.legalName, "Razão social", 200, false),
    cnpj: validateCnpj(input.cnpj),
    contactEmail: input.contactEmail ? email(input.contactEmail) : "",
    contactPhone: text(input.contactPhone, "Telefone", 30, false),
    status: status(input.status),
    isolationReady: input.isolationReady === true,
  };
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  await (await getDb()).collection("companies").updateOne({ _id: companyId }, { $set: next });
  await audit({ actor, action: "company.update", collection: "companies", documentId: companyId, companyId: companyIdText, before, after: { ...before, ...next } });
}

// ---------- users ----------

export async function createUser(actor: string, companyIdText: string, input: Record<string, unknown>, confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  await requireCompany(companyId);
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  const db = await getDb();
  if (await db.collection("users").countDocuments({ companyId }) >= USER_LIMIT) {
    throw new Error(`Limite de ${USER_LIMIT} contas por empresa atingido.`);
  }
  const now = new Date();
  const user: UserRecord = {
    _id: new ObjectId(), companyId, name: text(input.name, "Nome", 120), email: email(input.email),
    passwordHash: await hash(validatePassword(input.password), 12),
    permissions: parsePermissions(input.permissions), disabled: false, sessionVersion: 1, createdAt: now, updatedAt: now,
  };
  await db.collection<UserRecord>("users").insertOne(user);
  await audit({ actor, action: "user.create", collection: "users", documentId: user._id, companyId: companyIdText, after: user });
}

export async function updateUser(actor: string, companyIdText: string, userIdText: string, input: Record<string, unknown>, confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  const userId = objectId(userIdText, "Usuário");
  const company = await requireCompany(companyId);
  const users = (await getDb()).collection<UserRecord>("users");
  const before = await users.findOne({ _id: userId, companyId });
  if (!before) throw new Error("Usuário não encontrado nesta empresa.");
  const disabled = input.disabled === true;
  if (disabled && company.adminUserId?.equals(userId)) throw new Error("Defina outro administrador antes de desativar esta conta.");
  const password = typeof input.password === "string" && input.password ? validatePassword(input.password) : null;
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  const set = {
    name: text(input.name, "Nome", 120), email: email(input.email), permissions: parsePermissions(input.permissions), disabled,
    ...(password ? { passwordHash: await hash(password, 12) } : {}), updatedAt: new Date(),
  };
  // Any change ends the user's current sessions, as in the platform.
  await users.updateOne({ _id: userId, companyId }, { $set: set, $inc: { sessionVersion: 1 } });
  await audit({ actor, action: password ? "user.update+password" : "user.update", collection: "users", documentId: userId, companyId: companyIdText, before, after: { ...before, ...set } });
}

export async function setCompanyAdmin(actor: string, companyIdText: string, userIdText: string, confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  const userId = objectId(userIdText, "Usuário");
  const company = await requireCompany(companyId);
  const db = await getDb();
  const user = await db.collection<UserRecord>("users").findOne({ _id: userId, companyId, disabled: false });
  if (!user) throw new Error("Escolha um usuário ativo desta empresa.");
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  await db.collection("companies").updateOne({ _id: companyId }, {
    $set: { adminUserId: userId, accessControlVersion: 1 }, $inc: { userManagementVersion: 1 },
  });
  await db.collection("users").updateMany({ _id: { $in: [userId, ...(company.adminUserId ? [company.adminUserId] : [])] }, companyId }, {
    $inc: { sessionVersion: 1 }, $set: { updatedAt: new Date() },
  });
  await audit({ actor, action: "company.admin", collection: "companies", documentId: companyId, companyId: companyIdText, detail: `admin ${company.adminUserId ?? "—"} → ${userId}` });
}

// ---------- WhatsApp numbers ----------

export async function addWhatsAppConnection(actor: string, companyIdText: string, input: Record<string, unknown>, confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  await requireCompany(companyId);
  const wabaId = text(input.wabaId, "WABA ID", 30);
  const phoneNumberId = text(input.phoneNumberId, "Phone Number ID", 30);
  if (!/^\d{5,30}$/.test(wabaId) || !/^\d{5,30}$/.test(phoneNumberId)) throw new Error("WABA ID e Phone Number ID devem conter apenas números.");
  const accessToken = text(input.accessToken, "Access token", 4000);
  const db = await getDb();
  const connections = db.collection<ConnectionRecord>("whatsapp_embedded_signup_connections");
  const taken = await connections.findOne({ phoneNumberId, status: { $in: ["operational", "connected"] }, companyId: { $ne: companyId } });
  if (taken) throw new Error("Este número já está conectado a outra empresa.");
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  const meta = await db.collection<{ _id: string; appId?: string }>("whatsapp_embedded_signup_config").findOne({ _id: "active" });
  const makeOperational = input.makeOperational === true;
  const now = new Date();
  const connection: ConnectionRecord = {
    _id: randomUUID(), companyId, appId: meta?.appId ?? "", graphVersion: text(input.graphVersion, "Graph version", 10, false) || DEFAULT_GRAPH_VERSION,
    accessToken: encryptWhatsAppToken(accessToken), status: "connected", wabaId, phoneNumberId,
    displayPhoneNumber: text(input.displayPhoneNumber, "Número", 30, false) || undefined,
    label: text(input.label, "Nome", 80, false) || undefined, createdAt: now, updatedAt: now,
  };
  await connections.insertOne(connection);
  await audit({ actor, action: "whatsapp.add", collection: "whatsapp_embedded_signup_connections", documentId: connection._id, companyId: companyIdText, after: connection });
  if (makeOperational) await setConnectionStatus(actor, companyIdText, connection._id, "operational", confirmation);
}

export async function setConnectionStatus(actor: string, companyIdText: string, connectionId: string,
  next: "operational" | "connected" | "disconnected", confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  const connections = (await getDb()).collection<ConnectionRecord>("whatsapp_embedded_signup_connections");
  const connection = await connections.findOne({ _id: connectionId, companyId });
  if (!connection) throw new Error("Número não encontrado nesta empresa.");
  if (next === "operational" && (!connection.wabaId || !connection.phoneNumberId)) throw new Error("A conexão ainda não tem WABA e número.");
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  const updatedAt = new Date();
  // As in the platform: one operational number per company; the previous one becomes "connected".
  if (next === "operational") {
    await connections.updateMany({ companyId, _id: { $ne: connectionId }, status: "operational" }, { $set: { status: "connected", updatedAt } });
  }
  await connections.updateOne({ _id: connectionId, companyId }, { $set: { status: next, updatedAt } });
  await audit({ actor, action: "whatsapp.status", collection: "whatsapp_embedded_signup_connections", documentId: connectionId, companyId: companyIdText, detail: `${connection.status} → ${next}` });
}

// ---------- AI models ----------

const AI_FIELDS = ["activeProvider", "preferredProvider", "tasks", "audioTranscription"] as const;

export async function saveAiConfig(actor: string, companyIdText: string, json: string, confirmation?: string) {
  const companyId = objectId(companyIdText, "Empresa");
  await requireCompany(companyId);
  const input = parseEjsonObject(json, "Configuração de IA");
  const unknown = Object.keys(input).filter((key) => !(AI_FIELDS as readonly string[]).includes(key));
  if (unknown.length) throw new Error(`Campos não suportados: ${unknown.join(", ")}.`);
  if (!input.tasks || typeof input.tasks !== "object") throw new Error("Informe \"tasks\" com customer_agent e lead_qualification.");
  assertConfirmed(productionPhrase(companyId), confirmation, "Esta é a clínica em produção.");
  await writeAiConfig(actor, companyId, input, "ai.update");
}

export async function copyAiConfig(actor: string, sourceIdText: string, targetIds: string[], confirmation?: string) {
  const sourceId = objectId(sourceIdText, "Empresa de origem");
  const source = await (await getDb()).collection("ai_model_config").findOne({ _id: companyScopedId(sourceIdText, "active") as never });
  if (!source) throw new Error("A empresa de origem ainda não tem configuração de IA.");
  const targets = [...new Set(targetIds)].filter((id) => id !== sourceIdText).map((id) => objectId(id, "Empresa de destino"));
  if (!targets.length) throw new Error("Selecione ao menos uma empresa de destino.");
  const production = targets.some((id) => id.toHexString() === LEGACY_COMPANY_ID);
  assertConfirmed(production ? "PRODUCAO" : null, confirmation, "A clínica em produção está entre os destinos.");
  const fields = Object.fromEntries(AI_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  for (const target of targets) await writeAiConfig(actor, target, fields, `ai.copy-from:${sourceId.toHexString()}`);
  return targets.length;
}

async function writeAiConfig(actor: string, companyId: ObjectId, fields: Record<string, unknown>, action: string) {
  const collection = (await getDb()).collection("ai_model_config");
  const id = companyScopedId(companyId.toHexString(), "active");
  const before = await collection.findOne({ _id: id as never });
  const next = {
    ...(before ?? {}), ...fields, _id: id, companyId,
    revision: Number(before?.revision ?? 0) + 1, updatedAt: new Date(), updatedBy: `backoffice:${actor}`,
  };
  await collection.replaceOne({ _id: id as never }, next, { upsert: true });
  await audit({ actor, action, collection: "ai_model_config", documentId: id, companyId: companyId.toHexString(), before: before ?? undefined, after: next });
}
