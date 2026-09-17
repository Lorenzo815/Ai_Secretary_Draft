import { describe, expect, it } from "vitest";
import { parseUsdBrlRate } from "./usd-brl";

describe("parseUsdBrlRate", () => {
  it("accepts a valid Frankfurter response", () => {
    expect(parseUsdBrlRate({ date: "2026-09-17", rates: { BRL: 5.32 } })).toEqual({
      rate: 5.32,
      date: "2026-09-17",
      source: "Frankfurter",
    });
  });

  it("rejects missing or invalid rates", () => {
    expect(parseUsdBrlRate({ date: "2026-09-17", rates: {} })).toBeUndefined();
    expect(parseUsdBrlRate({ date: "2026-09-17", rates: { BRL: -1 } })).toBeUndefined();
  });
});