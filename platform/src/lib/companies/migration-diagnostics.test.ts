import { describe, expect, it } from "vitest";
import {
  atStage, attachRestoreDiagnostic, diagnosticError, formatDiagnostic,
} from "./migration-diagnostics";
import { MigrationSafetyError } from "./migration-safety";

describe("sanitized migration diagnostics", () => {
  const secret = "private-person private-key mongodb://user:password@private-host/ai_secretary";

  it("reports only stable stage/id and numeric Mongo code/codeName, never raw messages/records/stacks", async () => {
    const raw = Object.assign(new Error(secret), {
      code: 11000, codeName: "DuplicateKey", keyValue: { email: secret },
      errmsg: secret, errorResponse: { records: [secret] }, stack: secret,
    });
    const failure = await atStage("restore.document-insert", async () => { throw raw; }).catch((error) => error);
    const output = formatDiagnostic(failure);
    expect(JSON.parse(output)).toEqual({
      status: "failed", stage: "restore.document-insert",
      safetyErrorId: "CM_RESTORE_DOCUMENT_INSERT", mongoCode: 11000,
      mongoCodeName: "DuplicateKey", recoveryGate: "closed",
    });
    expect(output).not.toContain(secret);
    for (const forbidden of ["password", "private-host", "keyValue", "errorResponse", "stack", "errmsg"]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it("keeps precise callback stage/code through archive wrappers instead of losing the cause", async () => {
    const inner = diagnosticError(Object.assign(new Error(secret), { code: 13, codeName: "Unauthorized" }),
      "restore.collection-create");
    const wrapped = new MigrationSafetyError("Backup verification failed.", { cause: inner });
    const failure = await atStage("restore.archive-replay", async () => { throw wrapped; }).catch((error) => error);
    expect(JSON.parse(formatDiagnostic(failure))).toMatchObject({
      stage: "restore.collection-create", safetyErrorId: "CM_RESTORE_COLLECTION_CREATE",
      mongoCode: 13, mongoCodeName: "Unauthorized",
    });
    expect(formatDiagnostic(failure)).not.toContain(secret);
  });

  it("omits filesystem codes, malformed codeNames and all arbitrary error content", () => {
    const filesystem = Object.assign(new Error(secret), { code: "ENOENT", path: secret });
    expect(JSON.parse(formatDiagnostic(filesystem))).toEqual({
      status: "failed", stage: "cli.validation", safetyErrorId: "CM_CLI_VALIDATION", recoveryGate: "closed",
    });
    const malformed = Object.assign(new Error(secret), { code: 2, codeName: `BadValue\n${secret}` });
    expect(JSON.parse(formatDiagnostic(malformed))).toMatchObject({ mongoCode: 2 });
    expect(formatDiagnostic(malformed)).not.toContain("mongoCodeName");
    expect(formatDiagnostic(malformed)).not.toContain(secret);
  });

  it("reports only generated scratch names and explicit cleanup status", () => {
    const failure = diagnosticError(new Error(secret), "restore.marker-insert");
    attachRestoreDiagnostic(failure, {
      scratchDatabasePrefix: "cmr_", scratchDatabase: "ai_secretary", cleanup: "not-confirmed",
    });
    expect(JSON.parse(formatDiagnostic(failure)).restore).toEqual({
      scratchDatabasePrefix: "cmr_", cleanup: "not-confirmed",
    });
    attachRestoreDiagnostic(failure, {
      scratchDatabasePrefix: "cmr_",
      scratchDatabase: `cmr_${"a".repeat(32)}`, cleanup: "confirmed",
    });
    expect(JSON.parse(formatDiagnostic(failure)).restore.cleanup).toBe("confirmed");
  });
});
