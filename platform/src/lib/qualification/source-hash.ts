import { createHash } from "crypto";

export function buildQualificationSourceHash(input: unknown, configurationHash: string) {
  return createHash("sha256").update(JSON.stringify({ input, configurationHash })).digest("hex");
}