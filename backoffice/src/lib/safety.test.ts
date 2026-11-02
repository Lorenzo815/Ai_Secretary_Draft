import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { MASK, listMasks, maskDocument, restoreMasked } from "./masking";
import { requiredConfirmation, belongsToProduction } from "./risk";
import { LEGACY_COMPANY_ID, companyScopedId } from "./platform-rules";

const encrypted = { ciphertext: "c2VjcmV0", iv: "aXY=", authTag: "dGFn" };

describe("secret masking", () => {
  const document = {
    _id: new ObjectId(),
    name: "Clínica",
    accessToken: encrypted,
    passwordHash: "$2a$12$hash",
    verifyToken: "plain-token",
    profile: { cpf: { encrypted: "x", iv: "y", authTag: "z", hash: "h" }, fullName: "Ana" },
    endpoints: [{ url: "https://a", secret: "s1" }, { url: "https://b", secret: "s2" }],
    tokenCount: 3,
  };

  it("hides encrypted values, hashes and secret strings, keeping everything else", () => {
    const masked = maskDocument(document);
    expect(masked.name).toBe("Clínica");
    expect(masked.tokenCount).toBe(3);
    expect(masked.profile.fullName).toBe("Ana");
    expect(JSON.stringify(masked)).not.toMatch(/c2VjcmV0|\$2a\$12|plain-token|"s1"|"s2"|"h"/);
    expect(listMasks(masked).map((mask) => [mask.path, mask.kind, mask.revealable])).toEqual([
      ["accessToken", "encrypted", true], ["passwordHash", "hash", false], ["verifyToken", "secret", true],
      ["profile.cpf", "encrypted", true], ["endpoints.0.secret", "secret", true], ["endpoints.1.secret", "secret", true],
    ]);
  });

  it("puts the original secrets back on save, even if array items were reordered", () => {
    const edited = maskDocument(document) as Record<string, unknown> & { endpoints: unknown[] };
    edited.name = "Novo nome";
    edited.endpoints = [...edited.endpoints].reverse();
    const restored = restoreMasked(edited, document) as typeof document;
    expect(restored.name).toBe("Novo nome");
    expect(restored.accessToken).toEqual(encrypted);
    expect(restored.passwordHash).toBe("$2a$12$hash");
    expect(restored.endpoints.map((endpoint) => endpoint.secret)).toEqual(["s2", "s1"]);
  });

  it("refuses a marker that points to a field the original does not have", () => {
    expect(() => restoreMasked({ x: { [MASK]: { path: "missing", kind: "secret", revealable: true } } }, document))
      .toThrow("missing");
  });
});

describe("write confirmations", () => {
  it("asks for typed confirmation only on risky writes", () => {
    expect(requiredConfirmation({ operation: "update", collection: "crm_customers", touchesProduction: false })).toBeNull();
    expect(requiredConfirmation({ operation: "update", collection: "crm_customers", touchesProduction: true })).toBe("PRODUCAO");
    expect(requiredConfirmation({ operation: "update", collection: "ai_provider_credentials", touchesProduction: false })).toBe("PRODUCAO");
    expect(requiredConfirmation({ operation: "delete", collection: "crm_customers", touchesProduction: false })).toBe("EXCLUIR");
    expect(requiredConfirmation({ operation: "delete", collection: "crm_customers", touchesProduction: true })).toBe("EXCLUIR PRODUCAO");
    expect(requiredConfirmation({ operation: "bulk-update", collection: "x", touchesProduction: false, count: 12 })).toBe("12");
    expect(requiredConfirmation({ operation: "bulk-delete", collection: "x", touchesProduction: true, count: 3 })).toBe("3 PRODUCAO");
  });

  it("recognizes the live clinic's documents and the clinic itself", () => {
    const legacy = new ObjectId(LEGACY_COMPANY_ID);
    expect(belongsToProduction("crm_customers", { companyId: legacy })).toBe(true);
    expect(belongsToProduction("crm_customers", { companyId: new ObjectId() })).toBe(false);
    expect(belongsToProduction("companies", { _id: legacy })).toBe(true);
  });

  it("uses the platform's per-company settings ids", () => {
    expect(companyScopedId(LEGACY_COMPANY_ID, "active")).toBe("active");
    expect(companyScopedId("a".repeat(24), "active")).toBe(`${"a".repeat(24)}:active`);
  });
});
