import { MigrationSafetyError, RESTORE_DATABASE_PATTERN, RESTORE_DATABASE_PREFIX } from "./migration-safety";

const STAGES = [
  "cli.validation", "cli.proof-validation", "cli.connect", "cli.snapshot-support",
  "cli.backup", "cli.bootstrap", "cli.apply", "cli.inventory", "cli.disconnect",
  "cli.receipt-write", "cli.restore-test",
  "restore.archive-validation", "restore.source-binding", "restore.snapshot-support",
  "restore.database-availability", "restore.marker-create", "restore.marker-insert",
  "restore.collection-create", "restore.document-insert", "restore.bson-verify",
  "restore.archive-replay", "restore.archive-binding", "restore.index-create",
  "restore.index-verify", "restore.migration-dry-run", "restore.bootstrap-rehearsal",
  "restore.backfill-rehearsal", "restore.business-bson-verify", "restore.idempotence-rehearsal",
  "restore.final-count-verify", "restore.cleanup-guard", "restore.cleanup-drop",
  "restore.cleanup-confirm",
] as const;

export type MigrationStage = typeof STAGES[number];

interface FailureDetails {
  stage: MigrationStage;
  safetyErrorId: string;
  mongoCode?: number;
  mongoCodeName?: string;
}

export interface RestoreDiagnostic {
  scratchDatabasePrefix: typeof RESTORE_DATABASE_PREFIX;
  scratchDatabase?: string;
  cleanup: "not-created" | "not-confirmed" | "confirmed";
}

interface SafeDiagnostic extends FailureDetails {
  restore?: RestoreDiagnostic;
  priorFailure?: FailureDetails;
}

function* causes(error: unknown) {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if (visited.has(current)) break;
    visited.add(current);
    yield current as Record<string, unknown>;
    current = (current as Record<string, unknown>).cause;
  }
}

function mongoDetails(error: unknown): Pick<FailureDetails, "mongoCode" | "mongoCodeName"> {
  for (const item of causes(error)) {
    // String filesystem codes and all messages, stacks, records and connection details are excluded.
    if (typeof item.code !== "number" || !Number.isSafeInteger(item.code) || item.code < 0) continue;
    return {
      mongoCode: item.code,
      ...(typeof item.codeName === "string" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(item.codeName) ?
        { mongoCodeName: item.codeName } : {}),
    };
  }
  return {};
}

export class MigrationDiagnosticError extends MigrationSafetyError {
  readonly diagnostic: SafeDiagnostic;

  constructor(stage: MigrationStage, error: unknown) {
    const safeStage = STAGES.includes(stage) ? stage : "cli.validation";
    const safetyErrorId = `CM_${safeStage.replace(/[.-]/g, "_").toUpperCase()}`;
    super(`Operation failed at ${safeStage} [${safetyErrorId}].`);
    this.diagnostic = { stage: safeStage, safetyErrorId, ...mongoDetails(error) };
  }
}

export function diagnosticError(error: unknown, stage: MigrationStage): MigrationDiagnosticError {
  for (const item of causes(error)) {
    if (item instanceof MigrationDiagnosticError) return item;
  }
  return new MigrationDiagnosticError(stage, error);
}

export async function atStage<T>(stage: MigrationStage, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw diagnosticError(error, stage);
  }
}

export function attachRestoreDiagnostic(
  error: MigrationDiagnosticError,
  restore: RestoreDiagnostic,
): void {
  error.diagnostic.restore = {
    scratchDatabasePrefix: RESTORE_DATABASE_PREFIX,
    ...(restore.scratchDatabase && RESTORE_DATABASE_PATTERN.test(restore.scratchDatabase) ?
      { scratchDatabase: restore.scratchDatabase } : {}),
    cleanup: restore.cleanup,
  };
}

export function attachPriorFailure(error: MigrationDiagnosticError, prior: MigrationDiagnosticError): void {
  const { stage, safetyErrorId, mongoCode, mongoCodeName } = prior.diagnostic;
  error.diagnostic.priorFailure = { stage, safetyErrorId, mongoCode, mongoCodeName };
  if (prior.diagnostic.restore) attachRestoreDiagnostic(error, prior.diagnostic.restore);
}

export function formatDiagnostic(error: unknown): string {
  // Only these explicitly constructed fields are serialized; never serialize the Error itself.
  const { stage, safetyErrorId, mongoCode, mongoCodeName, restore, priorFailure } =
    diagnosticError(error, "cli.validation").diagnostic;
  return JSON.stringify({
    status: "failed", stage, safetyErrorId, mongoCode, mongoCodeName, restore, priorFailure,
    recoveryGate: "closed",
  });
}
