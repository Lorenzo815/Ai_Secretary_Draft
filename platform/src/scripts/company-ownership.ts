import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { LEGACY_COMPANY_ID } from "../lib/companies/ownership";
import {
  makeReceipt, requireProof, writeReceipt,
} from "../lib/companies/migration-backup";
import {
  assertSnapshotSupport, backupDatabase, backfillOwnership, bootstrapCompany,
  inventory, restoreAndRehearse, type Inventory,
} from "../lib/companies/migration";
import {
  DEFAULT_DATABASE, RESTORE_DATABASE_PREFIX, assertConfirmation, assertDatabaseName,
  externalPath, parseKey, requireSafe, sourceFingerprint,
} from "../lib/companies/migration-safety";
import {
  atStage, attachPriorFailure, attachRestoreDiagnostic, diagnosticError, formatDiagnostic,
  type MigrationDiagnosticError, type RestoreDiagnostic,
} from "../lib/companies/migration-diagnostics";

const HELP = `Guarded additive company ownership tooling (no command defaults to dry-run).
Run from platform:
  node --env-file=.env.local --import tsx src\\scripts\\company-ownership.ts COMMAND [options]
Commands: backup, restore-test, dry-run, bootstrap, apply, verify
Options:
  --database NAME             Default: ai_secretary
  --backup ABSOLUTE_PATH      Encrypted BSON archive, outside this repository
  --receipt ABSOLUTE_PATH     Restore-test output / bootstrap+apply required input
  --company-name NAME         Bootstrap only; default: Empresa atual
  --confirm-production TOKEN  Required for bootstrap/apply: DATABASE:${LEGACY_COMPANY_ID}
  --help                      No database connection
Environment:
  MONGODB_URI; COMPANY_MIGRATION_BACKUP_KEY (32-byte canonical base64)
  COMPANY_MIGRATION_RESTORE_URI (optional separate replica-set restore destination)
No production indexes are created/changed/dropped. TTL indexes are omitted ONLY
in the new random restore-test database. Existing backup/receipt files are never overwritten.`;

function printInventory(report: Inventory) {
  console.log(JSON.stringify({
    companyPresent: report.companyPresent,
    collections: report.collections,
    isolationReady: false,
  }));
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      database: { type: "string" }, backup: { type: "string" },
      receipt: { type: "string" }, "company-name": { type: "string" },
      "confirm-production": { type: "string" }, help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  requireSafe(positionals.length <= 1, "Supply exactly one command.");
  const command = positionals[0] ?? "dry-run";
  requireSafe(["backup", "restore-test", "dry-run", "bootstrap", "apply", "verify"].includes(command),
    "Unknown command; use --help.");
  const database = values.database ?? DEFAULT_DATABASE;
  assertDatabaseName(database);
  const uri = process.env.MONGODB_URI;
  requireSafe(uri, "MONGODB_URI is required.");
  const repository = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
  const mutation = command === "bootstrap" || command === "apply";
  const artifactCommand = command === "backup" || command === "restore-test" || mutation;
  const key = artifactCommand ? parseKey(process.env.COMPANY_MIGRATION_BACKUP_KEY) : undefined;
  const fingerprint = artifactCommand ? sourceFingerprint(uri, key!) : "";
  let backup: string | undefined;
  let receipt: string | undefined;
  if (artifactCommand) {
    requireSafe(values.backup, "--backup is required.");
    backup = await externalPath(values.backup, repository, command !== "backup");
  }
  if (command === "restore-test" || mutation) {
    requireSafe(values.receipt, "--receipt is required.");
    receipt = await externalPath(values.receipt, repository, mutation);
    requireSafe(backup !== receipt, "Backup and receipt paths must differ.");
  }
  if (mutation) {
    assertConfirmation(database, values["confirm-production"]);
    // No database connection or write occurs before full backup/receipt authentication.
    await atStage("cli.proof-validation", () => requireProof(backup!, receipt!, key!, database, fingerprint));
  }
  const targetUri = command === "restore-test" ? process.env.COMPANY_MIGRATION_RESTORE_URI ?? uri : uri;
  const client = new MongoClient(targetUri, {
    readPreference: "primary", retryWrites: true,
    writeConcern: { w: "majority" },
    serverSelectionTimeoutMS: 15_000,
  });
  let failure: MigrationDiagnosticError | undefined;
  let restoreDiagnostic: RestoreDiagnostic = {
    scratchDatabasePrefix: RESTORE_DATABASE_PREFIX, cleanup: "not-created",
  };
  try {
    await atStage("cli.connect", () => client.connect());
    await atStage("cli.snapshot-support", () => assertSnapshotSupport(client));
    const db = client.db(database);
    if (command === "backup") {
      const summary = await atStage("cli.backup", () => backupDatabase(client, db, backup!, key!, fingerprint));
      console.log(JSON.stringify({
        operation: "backup", backupSha256: summary.backupSha256, collections: summary.collections,
      }));
    } else if (command === "restore-test") {
      const result = await restoreAndRehearse(client, backup!, key!, database, fingerprint);
      restoreDiagnostic = {
        scratchDatabasePrefix: RESTORE_DATABASE_PREFIX, scratchDatabase: result.isolatedDatabase,
        cleanup: "confirmed",
      };
      // A receipt is persisted only AFTER BSON/index checks, rehearsal, idempotence, and cleanup.
      await atStage("cli.receipt-write", () => writeReceipt(receipt!, makeReceipt(result.summary), key!));
      console.log(JSON.stringify({
        operation: "restore-test", verified: true, cleanedUp: true,
        backupSha256: result.summary.backupSha256, ttlIndexesSkipped: result.ttlIndexesSkipped,
      }));
    } else if (command === "bootstrap") {
      const inserted = await atStage("cli.bootstrap", () => bootstrapCompany(client, db, values["company-name"]));
      console.log(JSON.stringify({ operation: "bootstrap", inserted, isolationReady: false }));
    } else if (command === "apply") {
      const result = await atStage("cli.apply", () => backfillOwnership(client, db));
      console.log(JSON.stringify({ operation: "apply", changed: result.changed }));
      printInventory(result.inventory);
    } else {
      const result = await atStage("cli.inventory", () => inventory(client, db));
      printInventory(result);
      if (command === "verify") {
        requireSafe(result.companyPresent && result.collections.every((item) => item.missing === 0),
          "Ownership coverage is incomplete; isolation must remain disabled.");
      }
    }
  } catch (error) {
    failure = diagnosticError(error, command === "restore-test" ? "cli.restore-test" : "cli.validation");
    if (command === "restore-test" && !failure.diagnostic.restore) {
      attachRestoreDiagnostic(failure, restoreDiagnostic);
    }
    throw failure;
  } finally {
    try {
      await atStage("cli.disconnect", () => client.close());
    } catch (error) {
      const disconnectFailure = diagnosticError(error, "cli.disconnect");
      if (failure) attachPriorFailure(disconnectFailure, failure);
      else if (command === "restore-test") attachRestoreDiagnostic(disconnectFailure, restoreDiagnostic);
      throw disconnectFailure;
    } finally {
      key?.fill(0);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Mongo errors (including duplicate key) may contain PII, secrets, or connection details.
    console.error(formatDiagnostic(error));
    process.exitCode = 1;
  });
}
