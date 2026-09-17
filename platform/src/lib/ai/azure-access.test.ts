import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { verifyAzureAccessPassword } from "./azure-access";

describe("Azure provider access", () => {
  afterEach(() => delete process.env.AZURE_PROVIDER_ACCESS_PASSWORD_HASH);

  it("accepts only the server-side Azure password", () => {
    process.env.AZURE_PROVIDER_ACCESS_PASSWORD_HASH = createHash("sha256")
      .update("test-password")
      .digest("hex");
    expect(verifyAzureAccessPassword("test-password")).toBe(true);
    expect(verifyAzureAccessPassword("wrong-password")).toBe(false);
    expect(verifyAzureAccessPassword(undefined)).toBe(false);
  });
});