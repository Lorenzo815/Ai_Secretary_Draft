import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";

const { headers } = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers }));

import { LEGACY_COMPANY_ID } from "./ownership";
import {
  COMPANY_HEADER,
  TenantResolutionError,
  companyFilter,
  currentCompanyId,
  runWithCompany,
  withCurrentCompany,
} from "./context";

const other = new ObjectId("0123456789abcdef01234567");

afterEach(() => {
  vi.unstubAllEnvs();
  headers.mockReset();
});

describe("tenant context", () => {
  it("uses the explicit scope before anything else", async () => {
    headers.mockResolvedValue(new Headers({ [COMPANY_HEADER]: LEGACY_COMPANY_ID }));
    await runWithCompany(other, async () => {
      expect((await currentCompanyId()).equals(other)).toBe(true);
    });
  });

  it("keeps concurrent scopes isolated", async () => {
    const seen: string[] = [];
    const first = new ObjectId();
    const second = new ObjectId();
    await Promise.all([
      runWithCompany(first, async () => { await new Promise((r) => setTimeout(r, 5)); seen.push(`a:${(await currentCompanyId()).toHexString()}`); }),
      runWithCompany(second, async () => { seen.push(`b:${(await currentCompanyId()).toHexString()}`); }),
    ]);
    expect(seen).toEqual(expect.arrayContaining([`a:${first.toHexString()}`, `b:${second.toHexString()}`]));
  });

  it("reads the trusted request header set by the proxy", async () => {
    headers.mockResolvedValue(new Headers({ [COMPANY_HEADER]: other.toHexString() }));
    expect((await currentCompanyId()).equals(other)).toBe(true);
  });

  it("ignores malformed header values", async () => {
    headers.mockResolvedValue(new Headers({ [COMPANY_HEADER]: "not-an-id" }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await currentCompanyId()).toHexString()).toBe(LEGACY_COMPANY_ID);
  });

  it("falls back to the original clinic outside a request, as today", async () => {
    headers.mockRejectedValue(new Error("outside request scope"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await currentCompanyId()).toHexString()).toBe(LEGACY_COMPANY_ID);
  });

  it("fails closed in strict mode", async () => {
    vi.stubEnv("TENANT_STRICT", "true");
    headers.mockRejectedValue(new Error("outside request scope"));
    await expect(currentCompanyId()).rejects.toBeInstanceOf(TenantResolutionError);
  });

  it("stamps and filters with the current company and refuses to change an owner", async () => {
    await runWithCompany(other, async () => {
      expect((await withCurrentCompany({ name: "x" })).companyId.equals(other)).toBe(true);
      expect((await companyFilter({ status: "active" })).companyId.equals(other)).toBe(true);
      await expect(withCurrentCompany({ companyId: new ObjectId(LEGACY_COMPANY_ID) })).rejects.toThrow();
    });
  });
});
