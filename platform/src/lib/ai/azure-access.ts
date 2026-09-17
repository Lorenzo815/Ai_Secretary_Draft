import "server-only";

import { createHash, timingSafeEqual } from "crypto";

const DEFAULT_AZURE_ACCESS_PASSWORD_HASH = "d537de0d4dbf7589ba1eadc4986aa2d85df1a367a5d5ffaf2b1b7c923fb95d70";

export function verifyAzureAccessPassword(password: unknown) {
  if (typeof password !== "string") return false;
  const suppliedHash = createHash("sha256").update(password).digest();
  const configuredHash = process.env.AZURE_PROVIDER_ACCESS_PASSWORD_HASH
    ?? DEFAULT_AZURE_ACCESS_PASSWORD_HASH;
  const expectedHash = Buffer.from(configuredHash, "hex");
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash);
}