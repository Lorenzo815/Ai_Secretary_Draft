import { parseArgs } from "node:util";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";
import { bootstrapUserAccess } from "../lib/access/management";
import { requireProof } from "../lib/companies/migration-backup";
import { assertConfirmation, externalPath, parseKey, requireSafe, sourceFingerprint } from "../lib/companies/migration-safety";
import { legacyCompanyId } from "../lib/companies/ownership";

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    "admin-id": { type: "string" }, backup: { type: "string" }, receipt: { type: "string" },
    "confirm-production": { type: "string" },
  } });
  assertConfirmation("ai_secretary", values["confirm-production"]);
  requireSafe(values["admin-id"] && /^[a-f0-9]{24}$/i.test(values["admin-id"]), "Explicit existing admin ID required.");
  requireSafe(values.backup && values.receipt, "Verified backup and receipt required.");
  const uri = process.env.MONGODB_URI;
  requireSafe(uri, "MONGODB_URI required.");
  const key = parseKey(process.env.COMPANY_MIGRATION_BACKUP_KEY);
  const repository = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
  const client = new MongoClient(uri);
  try {
    const backup = await externalPath(values.backup, repository, true);
    const receipt = await externalPath(values.receipt, repository, true);
    await requireProof(backup, receipt, key, "ai_secretary", sourceFingerprint(uri, key));
    await client.connect();
    const inserted = await bootstrapUserAccess(client, legacyCompanyId(), new ObjectId(values["admin-id"]));
    console.log(JSON.stringify({ operation: "bootstrap-user-access", initialized: inserted, userLimit: 25 }));
  } finally { key.fill(0); await client.close(); }
}

main().catch(error => {
  console.error(JSON.stringify({ operation: "bootstrap-user-access", status: "failed", errorType: error instanceof Error ? error.name : "Unknown", recoveryGate: "closed" }));
  process.exitCode = 1;
});
