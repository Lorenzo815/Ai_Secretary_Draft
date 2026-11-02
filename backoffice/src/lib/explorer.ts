import "server-only";

import { ObjectId, type Document, type Filter } from "mongodb";
import { audit } from "./audit";
import { parseEjson, parseEjsonObject, toEjson } from "./actions";
import { decryptValue } from "./crypto";
import { getDb } from "./mongodb";
import { getPath, isEncryptedShape, listMasks, maskDocument, restoreMasked, type MaskInfo } from "./masking";
import { assertConfirmed, belongsToProduction, requiredConfirmation } from "./risk";

const NAME = /^[A-Za-z0-9_.-]{1,120}$/;

export async function listCollectionsInfo() {
  const db = await getDb();
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith("system."))
    .sort();
  return Promise.all(collections.map(async (name) => {
    const [count, stats] = await Promise.all([
      db.collection(name).estimatedDocumentCount(),
      db.collection(name).aggregate<{ storageStats?: { size?: number; storageSize?: number; totalIndexSize?: number } }>(
        [{ $collStats: { storageStats: {} } }],
      ).toArray().catch(() => []),
    ]);
    const storage = stats[0]?.storageStats;
    return { name, count, dataBytes: storage?.size ?? 0, storageBytes: (storage?.storageSize ?? 0) + (storage?.totalIndexSize ?? 0) };
  }));
}

export async function assertCollection(name: string) {
  if (!NAME.test(name) || name.startsWith("system.")) throw new Error("Coleção inválida.");
  const exists = await (await getDb()).listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) throw new Error(`A coleção "${name}" não existe.`);
  return name;
}

/** Clinics in production: status "active". Their data needs typed confirmation to change. */
export async function liveCompanyIds(): Promise<Set<string>> {
  const live = await (await getDb()).collection("companies").find({ status: "active" }, { projection: { _id: 1 } }).toArray();
  return new Set(live.map((company) => String(company._id)));
}

export async function companyNames() {
  const companies = await (await getDb()).collection("companies")
    .find({}, { projection: { name: 1 } }).toArray();
  return new Map(companies.map((company) => [String(company._id), String(company.name ?? company._id)]));
}

export interface QueryInput {
  collection: string;
  company?: string;
  filter?: string;
  id?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  size?: number;
}

export function buildFilter(input: Pick<QueryInput, "company" | "filter" | "id">): Filter<Document> {
  const filter: Document = parseEjsonObject(input.filter ?? "", "Filtro");
  if (input.company === "none") filter.companyId = { $exists: false };
  else if (input.company && ObjectId.isValid(input.company)) filter.companyId = new ObjectId(input.company);
  const id = input.id?.trim();
  if (id) filter._id = /^[a-f0-9]{24}$/i.test(id) ? { $in: [new ObjectId(id), id] } : id;
  return filter as Filter<Document>;
}

export async function queryCollection(input: QueryInput) {
  const collection = (await getDb()).collection(await assertCollection(input.collection));
  const filter = buildFilter(input);
  const size = Math.min(Math.max(Math.trunc(input.size ?? 25), 5), 200);
  const page = Math.max(Math.trunc(input.page ?? 1), 1);
  const sortField = input.sort && /^[A-Za-z0-9_.]{1,120}$/.test(input.sort) ? input.sort : "_id";
  const [rows, total] = await Promise.all([
    collection.find(filter).sort({ [sortField]: input.dir === "asc" ? 1 : -1 }).skip((page - 1) * size).limit(size).toArray(),
    collection.countDocuments(filter),
  ]);
  return { rows: rows.map((row) => maskDocument(row)), total, page, size, sortField };
}

function idFromText(idText: string) {
  const id = parseEjson(idText, "Identificador");
  if (id === null || id === undefined || (typeof id === "object" && !(id instanceof ObjectId))) {
    throw new Error("Identificador inválido.");
  }
  return id;
}

async function loadDocument(collectionName: string, idText: string) {
  const collection = (await getDb()).collection(await assertCollection(collectionName));
  const id = idFromText(idText);
  const document = await collection.findOne({ _id: id as never });
  if (!document) throw new Error("Documento não encontrado. Ele pode ter sido alterado ou removido.");
  return { collection, id, document };
}

export async function getDocument(collectionName: string, idText: string) {
  const { document } = await loadDocument(collectionName, idText);
  const masked = maskDocument(document);
  return { json: toEjson(masked), masks: listMasks(masked), production: belongsToProduction(collectionName, document, await liveCompanyIds()) };
}

export async function saveDocument(actor: string, collectionName: string, idText: string, json: string, confirmation?: string) {
  const { collection, id, document } = await loadDocument(collectionName, idText);
  const edited = restoreMasked(parseEjsonObject(json, "Documento"), document) as Document;
  if (toEjson(edited._id, false) !== toEjson(id, false)) throw new Error("O _id não pode ser alterado.");
  const live = await liveCompanyIds();
  const production = belongsToProduction(collectionName, document, live) || belongsToProduction(collectionName, edited, live);
  assertConfirmed(requiredConfirmation({ operation: "update", collection: collectionName, touchesProduction: production }), confirmation,
    "Este documento pertence a uma clínica em produção ou a configurações globais da Oria.");
  const result = await collection.replaceOne({ _id: id as never }, edited);
  if (result.matchedCount !== 1) throw new Error("Documento não encontrado ao salvar.");
  await audit({ actor, action: "document.replace", collection: collectionName, documentId: id, companyId: ownerOf(collectionName, edited), before: document, after: edited });
}

export async function insertDocument(actor: string, collectionName: string, json: string, confirmation?: string) {
  const collection = (await getDb()).collection(await assertCollection(collectionName));
  const document = parseEjsonObject(json, "Documento") as Document;
  if (listMasks(document).length) throw new Error("Um novo documento não pode conter campos mascarados; remova-os ou informe valores.");
  document._id ??= new ObjectId();
  assertConfirmed(requiredConfirmation({ operation: "insert", collection: collectionName, touchesProduction: belongsToProduction(collectionName, document, await liveCompanyIds()) }),
    confirmation, "O novo documento pertence a uma clínica em produção ou a configurações globais da Oria.");
  await collection.insertOne(document);
  await audit({ actor, action: "document.insert", collection: collectionName, documentId: document._id, companyId: ownerOf(collectionName, document), after: document });
  return toEjson(document._id, false);
}

export async function deleteDocument(actor: string, collectionName: string, idText: string, confirmation?: string) {
  const { collection, id, document } = await loadDocument(collectionName, idText);
  assertConfirmed(requiredConfirmation({ operation: "delete", collection: collectionName, touchesProduction: belongsToProduction(collectionName, document, await liveCompanyIds()) }),
    confirmation, "Excluir é irreversível.");
  await collection.deleteOne({ _id: id as never });
  await audit({ actor, action: "document.delete", collection: collectionName, documentId: id, companyId: ownerOf(collectionName, document), before: document });
}

export async function previewBulk(input: Pick<QueryInput, "collection" | "company" | "filter" | "id">) {
  const collection = (await getDb()).collection(await assertCollection(input.collection));
  const filter = buildFilter(input);
  const live = [...await liveCompanyIds()].map((id) => new ObjectId(id));
  const productionFilter = input.collection === "companies"
    ? { $and: [filter, { _id: { $in: live } }] }
    : { $and: [filter, { companyId: { $in: live } }] };
  const [count, production] = await Promise.all([collection.countDocuments(filter), collection.countDocuments(productionFilter)]);
  return { filter, count, production };
}

export async function bulkWrite(actor: string, input: Pick<QueryInput, "collection" | "company" | "filter" | "id"> & {
  operation: "bulk-update" | "bulk-delete";
  update?: string;
  confirmation?: string;
}) {
  const { filter, count, production } = await previewBulk(input);
  if (count === 0) throw new Error("Nenhum documento corresponde ao filtro.");
  const update = input.operation === "bulk-update" ? parseEjson(input.update ?? "", "Atualização") : undefined;
  if (input.operation === "bulk-update" && (!update || typeof update !== "object")) {
    throw new Error("Informe a atualização, por exemplo {\"$set\": {\"campo\": \"valor\"}} ou um pipeline.");
  }
  if (input.operation === "bulk-update" && !Array.isArray(update) &&
    Object.keys(update as object).some((key) => !key.startsWith("$"))) {
    throw new Error("Use operadores de atualização ($set, $unset, $inc...) ou um pipeline; a substituição em massa não é permitida.");
  }
  assertConfirmed(requiredConfirmation({ operation: input.operation, collection: input.collection, touchesProduction: production > 0, count }),
    input.confirmation, `${count} documento(s) serão afetados${production ? `, ${production} de clínicas em produção` : ""}.`);
  const collection = (await getDb()).collection(input.collection);
  const result = input.operation === "bulk-delete"
    ? await collection.deleteMany(filter)
    : await collection.updateMany(filter, update as Document);
  const affected = "deletedCount" in result ? result.deletedCount : result.modifiedCount;
  await audit({ actor, action: input.operation === "bulk-delete" ? "bulk.delete" : "bulk.update", collection: input.collection, filter, update, count: affected });
  return affected;
}

export async function revealField(actor: string, collectionName: string, idText: string, path: string) {
  const { id, document } = await loadDocument(collectionName, idText);
  const value = getPath(document, path);
  const masked = listMasks(maskDocument(document)).find((mask: MaskInfo) => mask.path === path);
  if (!masked) throw new Error("Este campo não é protegido.");
  if (!masked.revealable) throw new Error("Este campo é um hash e não pode ser revelado.");
  const plain = isEncryptedShape(value) ? decryptValue(value) : String(value);
  await audit({ actor, action: "secret.reveal", collection: collectionName, documentId: id, companyId: ownerOf(collectionName, document), detail: path });
  return plain;
}

function ownerOf(collection: string, document: Document) {
  const owner = collection === "companies" ? document._id : document.companyId;
  return owner ? String(owner) : null;
}
