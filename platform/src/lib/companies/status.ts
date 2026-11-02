import "server-only";

import type { ObjectId } from "mongodb";
import { getMongoClient } from "../mongodb";
import { legacyCompanyId } from "./ownership";

export interface CompanyStatusDocument {
  _id: ObjectId;
  status?: string;
  isolationReady?: boolean;
}

/**
 * Whether a company may sign in and receive, process and send live WhatsApp traffic.
 * The original clinic keeps today's rule (active). Any other company must be marked `isolationReady: true`
 * by the Oria back-office, and the platform must run with TENANT_STRICT=true, so that an operation without
 * a resolved company fails instead of falling back to the original clinic.
 */
export function isCompanyDocumentOperational(companyId: ObjectId, company: CompanyStatusDocument | null) {
  if (!company) return false;
  if (companyId.equals(legacyCompanyId())) return company.status === "active";
  return process.env.TENANT_STRICT === "true" && company.isolationReady === true &&
    (company.status === "active" || company.status === "test");
}

export async function isCompanyOperational(companyId: ObjectId) {
  const company = await (await getMongoClient()).db("ai_secretary")
    .collection<CompanyStatusDocument>("companies")
    .findOne({ _id: companyId }, { projection: { status: 1, isolationReady: 1 } });
  return isCompanyDocumentOperational(companyId, company);
}
