import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { LEGACY_COMPANY_ID, legacyCompanyId, withLegacyCompany } from "./ownership";

describe("legacy company ownership metadata", () => {
  it("only adds ownership and does not mutate existing business fields or the source", () => {
    const original = { _id: new ObjectId(), updatedAt: new Date(), status: "scheduled", amountCents: 100 };

    expect(withLegacyCompany(original)).toEqual({ ...original, companyId: new ObjectId(LEGACY_COMPANY_ID) });
    expect(original).not.toHaveProperty("companyId");
  });

  it("preserves matching ownership on subsequent writes", () => {
    expect(withLegacyCompany({ companyId: legacyCompanyId(), value: "existing" }))
      .toEqual({ companyId: legacyCompanyId(), value: "existing" });
  });

  it.each([null, undefined, "another-company", new ObjectId()])("rejects an existing conflicting ownership value %s", companyId => {
    expect(() => withLegacyCompany({ companyId })).toThrow("não pode ser substituída");
  });
});
