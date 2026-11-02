import "server-only";

import type { ObjectId } from "mongodb";
import { getMongoClient } from "../mongodb";
import { legacyCompanyId } from "./ownership";

interface CompanyStatusDocument {
  _id: ObjectId;
  status?: string;
  isolationReady?: boolean;
}

/**
 * Whether a company may receive, process and send live WhatsApp traffic.
 * The original clinic keeps today's rule (active). Any other company must also be explicitly marked
 * `isolationReady: true` — set only by the Oria back-office once tenant isolation is complete.
 */
export async function isCompanyOperational(companyId: ObjectId) {
  const company = await (await getMongoClient()).db("ai_secretary")
    .collection<CompanyStatusDocument>("companies")
    .findOne({ _id: companyId }, { projection: { status: 1, isolationReady: 1 } });
  if (!company) return false;
  if (companyId.equals(legacyCompanyId())) return company.status === "active";
  return company.isolationReady === true && (company.status === "active" || company.status === "test");
}
