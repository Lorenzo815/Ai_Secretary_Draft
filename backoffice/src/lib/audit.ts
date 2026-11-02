import "server-only";

import { BSON, ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { maskDocument } from "./masking";

export const AUDIT_COLLECTION = "backoffice_audit";

export interface AuditEntry {
  actor: string;
  action: string;
  collection?: string;
  documentId?: unknown;
  companyId?: string | null;
  filter?: unknown;
  update?: unknown;
  before?: unknown;
  after?: unknown;
  count?: number;
  detail?: string;
}

const toText = (value: unknown) => value === undefined ? undefined : BSON.EJSON.stringify(value, { relaxed: false });

/** Records a back-office change. Documents are stored with secrets masked; filters/updates as Extended JSON text. */
export async function audit(entry: AuditEntry) {
  await (await getDb()).collection(AUDIT_COLLECTION).insertOne({
    _id: new ObjectId(),
    at: new Date(),
    actor: entry.actor,
    action: entry.action,
    collection: entry.collection,
    documentId: toText(entry.documentId),
    companyId: entry.companyId ?? null,
    filter: toText(entry.filter),
    update: toText(entry.update),
    before: entry.before === undefined ? undefined : maskDocument(entry.before),
    after: entry.after === undefined ? undefined : maskDocument(entry.after),
    count: entry.count,
    detail: entry.detail,
  });
}
