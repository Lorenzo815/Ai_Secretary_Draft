import "server-only";

import { createCipheriv, createHash, createHmac, randomBytes } from "crypto";
import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { CustomerProfileValidationError, isValidBirthDate, isValidCpf, isValidFullName, isValidPhone, normalizeCpf, normalizePhone } from "./validation";

export interface CustomerIdentifier {
  kind: string;
  value: string;
  provider?: string;
}

export type CustomerServiceStatus = "ai_active" | "waiting_human" | "human_active" | "closed";
export type CustomerRelationshipStatus = "new" | "returning";

export interface CustomerAddress {
  postalCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  number?: string;
  complement?: string;
}

export interface CustomerProfile {
  fullName?: string;
  birthDate?: string;
  cpf?: { encrypted: string; iv: string; authTag: string; hash: string; last4: string };
  address?: CustomerAddress;
  profession?: string;
  updatedAt: Date;
}

export interface LeadFitScore {
  level: "high" | "medium" | "low" | "insufficient_data";
  score: number;
  confidence: "high" | "medium" | "low";
  rationale: string;
}

export interface CustomerLeadQualification {
  version: 2;
  generatedAt: Date;
  model: string;
  sourceHash: string;
  profileContext: {
    ageYears: number;
    neighborhood: string;
    city: string;
    state: string;
  };
  profileFit: LeadFitScore;
  combinedFit: LeadFitScore;
  explicitSignals: {
    schedulingIntent: "strong" | "moderate" | "weak" | "unknown";
    priceSentiment: "positive" | "neutral" | "concerned" | "negative" | "unknown";
    engagement: "high" | "medium" | "low";
    evidence: Array<{ signal: string; observation: string }>;
  };
  logistics: {
    clinicCity: string;
    customerCity: string;
    customerNeighborhood: string;
    distanceReference: string;
    proximity: "same_city" | "nearby" | "regional" | "distant" | "unknown";
    estimatedDistanceKm: number | null;
    confidence: "high" | "medium" | "low";
    rationale: string;
  };
  occupationMarketBenchmark: {
    profession: string;
    geographyBasis: string;
    estimatedMonthlyGrossRangeBRL: { min: number; max: number } | null;
    confidence: "high" | "medium" | "low";
    rationale: string;
    caveats: string[];
  };
  strengths: string[];
  frictions: string[];
  openQuestions: string[];
  recommendedApproach: string;
  reasoningSummary: string;
  limitations: string[];
}

export interface CustomerLeadQualificationHistoryDocument extends CustomerLeadQualification {
  _id: ObjectId;
  customerId: ObjectId;
}

export interface CustomerDocument {
  _id: ObjectId;
  name: string;
  phones: string[];
  identifiers: CustomerIdentifier[];
  serviceStatus?: CustomerServiceStatus;
  relationship?: {
    status: CustomerRelationshipStatus;
    source: "customer" | "staff";
    classifiedAt: Date;
  };
  profile?: CustomerProfile;
  leadQualification?: CustomerLeadQualification;
  firstInteractionAt: Date;
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerOperationsDocument extends CustomerDocument {
  flow?: {
    flowKey: string;
    flowVersion: number;
    status: "active" | "completed";
    state: { stage: string; missingData: string[] };
    completionCode?: string;
    completionReason?: string;
  };
  conversationState?: { summary: string; updatedAt: Date };
  nextAppointment?: {
    _id: ObjectId;
    startAt: Date;
    timezone: string;
    status: "scheduled";
  };
  latestMessage?: { direction: "inbound" | "outbound"; body: string; timestamp: Date };
  messageAfterClosure?: boolean;
}

const DB_NAME = "ai_secretary";

async function getCustomersCollection(): Promise<Collection<CustomerDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CustomerDocument>("crm_customers");
}

export async function findOrCreateCustomerFromWhatsApp(input: {
  phone: string;
  name?: string;
  interactionAt: Date;
}) {
  const customers = await getCustomersCollection();
  await ensureCustomerIndexes();

  const phone = input.phone.replace(/\D/g, "");
  const now = new Date();
  const customer = await customers.findOneAndUpdate(
    {
      identifiers: {
        $elemMatch: { kind: "whatsapp_phone", value: phone },
      },
    },
    {
      $set: {
        ...(input.name ? { name: input.name } : {}),
        updatedAt: now,
      },
      $min: { firstInteractionAt: input.interactionAt },
      $max: { lastInteractionAt: input.interactionAt },
      $setOnInsert: {
        _id: new ObjectId(),
        ...(!input.name ? { name: phone } : {}),
        phones: [phone],
        identifiers: [
          { kind: "whatsapp_phone", value: phone, provider: "whatsapp" },
        ],
        serviceStatus: "ai_active",
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!customer) throw new Error("Não foi possível criar o cliente no CRM.");
  return customer;
}

export async function listCustomers() {
  const customers = await getCustomersCollection();
  return customers.find({}).sort({ lastInteractionAt: -1 }).toArray();
}

export async function findCustomerById(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const customers = await getCustomersCollection();
  return customers.findOne({ _id: new ObjectId(id) });
}

export async function updateCustomerServiceStatus(id: ObjectId, status: CustomerServiceStatus) {
  const customer = await (await getCustomersCollection()).findOneAndUpdate(
    { _id: id },
    { $set: { serviceStatus: status, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!customer) throw new Error("Cliente não encontrado.");
  return customer;
}

export async function classifyCustomerRelationship(
  id: ObjectId,
  status: CustomerRelationshipStatus,
) {
  const customer = await (await getCustomersCollection()).findOneAndUpdate(
    { _id: id },
    {
      $set: {
        relationship: { status, source: "customer", classifiedAt: new Date() },
        serviceStatus: status === "returning" ? "waiting_human" : "ai_active",
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!customer) throw new Error("Cliente não encontrado.");
  return customer;
}

export async function updateCustomerProfile(id: ObjectId, input: {
  fullName?: string;
  birthDate?: string;
  cpf?: string;
  postalCode?: string;
  addressNumber?: string;
  addressComplement?: string;
  secondaryPhones?: string[];
  profession?: string;
}) {
  const customers = await getCustomersCollection();
  const current = await customers.findOne({ _id: id });
  if (!current) throw new Error("Cliente não encontrado.");
  const now = new Date();
  const fields: Record<string, unknown> = { "profile.updatedAt": now, updatedAt: now };

  if (input.fullName !== undefined) {
    const fullName = input.fullName.trim().replace(/\s+/g, " ");
    if (!isValidFullName(fullName)) throw new CustomerProfileValidationError("Informe nome e sobrenome.");
    fields.name = fullName;
    fields["profile.fullName"] = fullName;
  }
  if (input.birthDate !== undefined) {
    if (!isValidBirthDate(input.birthDate)) throw new CustomerProfileValidationError("A data de nascimento deve ser válida e usar AAAA-MM-DD.");
    fields["profile.birthDate"] = input.birthDate;
  }
  if (input.cpf !== undefined) {
    if (!isValidCpf(input.cpf)) throw new CustomerProfileValidationError("O CPF informado é inválido.");
    fields["profile.cpf"] = protectCpf(normalizeCpf(input.cpf));
  }
  if (input.postalCode !== undefined) {
    const address = await resolvePostalCode(input.postalCode);
    fields["profile.address"] = {
      ...address,
      number: input.addressNumber?.trim() || current.profile?.address?.number,
      complement: input.addressComplement?.trim() || current.profile?.address?.complement,
    };
  } else {
    if (input.addressNumber !== undefined) {
      if (!current.profile?.address) throw new CustomerProfileValidationError("Informe primeiro um CEP válido.");
      fields["profile.address.number"] = input.addressNumber.trim();
    }
    if (input.addressComplement !== undefined) {
      if (!current.profile?.address) throw new CustomerProfileValidationError("Informe primeiro um CEP válido.");
      fields["profile.address.complement"] = input.addressComplement.trim();
    }
  }
  if (input.profession !== undefined) {
    const profession = input.profession.trim();
    if (profession.length < 2) throw new CustomerProfileValidationError("Informe uma profissão válida.");
    fields["profile.profession"] = profession.slice(0, 120);
  }

  const secondaryPhones = [...new Set((input.secondaryPhones ?? []).map(normalizePhone))]
    .filter((phone) => phone && !current.phones.includes(phone));
  if (secondaryPhones.some((phone) => !isValidPhone(phone))) {
    throw new CustomerProfileValidationError("Um dos telefones secundários é inválido.");
  }

  const customer = await customers.findOneAndUpdate(
    { _id: id },
    {
      $set: fields,
      ...(secondaryPhones.length > 0 ? { $addToSet: { phones: { $each: secondaryPhones } } } : {}),
    },
    { returnDocument: "after" },
  );
  if (!customer) throw new Error("Cliente não encontrado.");
  return customer;
}

export interface CustomerProfileSnapshot {
  relationshipStatus: CustomerRelationshipStatus | "unknown";
  fullName: string | null;
  birthDate: string | null;
  cpf: string | null;
  address: {
    postalCode: string;
    street: string;
    neighborhood: string;
    city: string;
    state: string;
    number: string | null;
    complement: string | null;
  } | null;
  phones: string[];
  profession: string | null;
  missingFields: string[];
}

export function getCustomerProfileSnapshot(customer: CustomerDocument): CustomerProfileSnapshot {
  const address = customer.profile?.address;
  return {
    relationshipStatus: customer.relationship?.status ?? "unknown",
    fullName: customer.profile?.fullName ?? null,
    birthDate: customer.profile?.birthDate ?? null,
    cpf: customer.profile?.cpf ? `***${customer.profile.cpf.last4}` : null,
    address: address ? {
      postalCode: address.postalCode,
      street: address.street,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      number: address.number ?? null,
      complement: address.complement ?? null,
    } : null,
    phones: customer.phones,
    profession: customer.profile?.profession ?? null,
    missingFields: [
      ...(!customer.relationship ? ["relationshipStatus"] : []),
      ...(!customer.profile?.fullName ? ["fullName"] : []),
      ...(!customer.profile?.birthDate ? ["birthDate"] : []),
      ...(!customer.profile?.cpf ? ["cpf"] : []),
      ...(!address ? ["postalCode"] : []),
      ...(address && !address.number ? ["addressNumber"] : []),
      ...(!customer.profile?.profession ? ["profession"] : []),
    ],
  };
}

export async function ensureCustomerIndexes() {
  const customers = await getCustomersCollection();
  await Promise.all([
    customers.createIndex(
      { "identifiers.kind": 1, "identifiers.value": 1 },
      { unique: true },
    ),
    customers.createIndex({ lastInteractionAt: -1 }),
    customers.createIndex({ "profile.cpf.hash": 1 }, { unique: true, sparse: true }),
  ]);
}

async function resolvePostalCode(value: string): Promise<CustomerAddress> {
  const postalCode = value.replace(/\D/g, "");
  if (postalCode.length !== 8) throw new CustomerProfileValidationError("O CEP deve conter 8 dígitos.");
  const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Não foi possível consultar o CEP agora.");
  const result = await response.json() as {
    erro?: boolean;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
  };
  if (result.erro || !result.localidade || !result.uf) throw new CustomerProfileValidationError("CEP não encontrado.");
  return {
    postalCode,
    street: result.logradouro?.trim() ?? "",
    neighborhood: result.bairro?.trim() ?? "",
    city: result.localidade.trim(),
    state: result.uf.trim(),
  };
}

function protectCpf(cpf: string) {
  const secret = process.env.PII_ENCRYPTION_KEY
    ?? (process.env.NODE_ENV === "development" ? process.env.NEXTAUTH_SECRET : undefined);
  if (!secret) throw new Error("PII_ENCRYPTION_KEY não está configurada.");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(cpf, "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    hash: createHmac("sha256", key).update(cpf).digest("hex"),
    last4: cpf.slice(-4),
  };
}

export async function listCustomerOperations() {
  const customers = await getCustomersCollection();
  const now = new Date();
  return customers.aggregate<CustomerOperationsDocument>([
    { $sort: { lastInteractionAt: -1 } },
    {
      $lookup: {
        from: "assistant_customer_flows",
        let: { customerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$customerId", "$$customerId"] } } },
          { $sort: { updatedAt: -1 } },
          { $limit: 1 },
        ],
        as: "flowDocuments",
      },
    },
    {
      $lookup: {
        from: "assistant_conversation_states",
        localField: "_id",
        foreignField: "customerId",
        as: "conversationDocuments",
      },
    },
    {
      $lookup: {
        from: "calendar_appointments",
        let: { customerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$customerId", "$$customerId"] },
            { $eq: ["$status", "scheduled"] },
            { $gte: ["$startAt", now] },
          ] } } },
          { $sort: { startAt: 1 } },
          { $limit: 1 },
        ],
        as: "appointmentDocuments",
      },
    },
    {
      $lookup: {
        from: "whatsapp_messages",
        let: { customerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$customerId", "$$customerId"] } } },
          { $sort: { timestamp: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, direction: 1, body: 1, timestamp: 1 } },
        ],
        as: "messageDocuments",
      },
    },
    { $set: {
      flow: { $arrayElemAt: ["$flowDocuments", 0] },
      conversationState: { $arrayElemAt: ["$conversationDocuments", 0] },
      nextAppointment: { $arrayElemAt: ["$appointmentDocuments", 0] },
      latestMessage: { $arrayElemAt: ["$messageDocuments", 0] },
    } },
    { $set: {
      messageAfterClosure: {
        $and: [
          { $eq: ["$serviceStatus", "closed"] },
          { $eq: ["$latestMessage.direction", "inbound"] },
          { $gt: ["$latestMessage.timestamp", "$flow.completedAt"] },
        ],
      },
    } },
    { $unset: ["flowDocuments", "conversationDocuments", "appointmentDocuments", "messageDocuments"] },
  ]).toArray();
}

export async function saveCustomerLeadQualification(
  id: ObjectId,
  qualification: CustomerLeadQualification,
) {
  const client = await clientPromise;
  const database = client.db(DB_NAME);
  const customers = database.collection<CustomerDocument>("crm_customers");
  const history = database.collection<CustomerLeadQualificationHistoryDocument>("lead_qualification_history");
  await Promise.all([
    history.createIndex({ customerId: 1, version: 1, sourceHash: 1 }, { unique: true }),
    history.createIndex({ generatedAt: 1 }),
  ]);

  const session = client.startSession();
  let customer: CustomerDocument | null = null;
  try {
    await session.withTransaction(async () => {
      const historyEntry: CustomerLeadQualificationHistoryDocument = {
        _id: new ObjectId(),
        customerId: id,
        ...qualification,
      };
      await history.updateOne(
        { customerId: id, version: qualification.version, sourceHash: qualification.sourceHash },
        { $setOnInsert: historyEntry },
        { upsert: true, session },
      );
      customer = await customers.findOneAndUpdate(
        { _id: id },
        { $set: { leadQualification: qualification, updatedAt: new Date() } },
        { returnDocument: "after", session },
      );
      if (!customer) throw new Error("Cliente não encontrado.");
    });
  } finally {
    await session.endSession();
  }
  if (!customer) throw new Error("Cliente não encontrado.");
  return customer;
}