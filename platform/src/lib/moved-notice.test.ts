import { describe, expect, it } from "vitest";
import { MOVED_TO_ORIGIN, movedTargetUrl } from "./moved-notice";

describe("moved notice target", () => {
  it("keeps the same screen at the new address", () => {
    expect(movedTargetUrl("/dashboard/calendario?dia=2")).toBe(`${MOVED_TO_ORIGIN}/dashboard/calendario?dia=2`);
    expect(movedTargetUrl("/")).toBe(`${MOVED_TO_ORIGIN}/dashboard`);
  });
  it.each([undefined, "", "https://evil.example", "//evil.example", "/\\evil.example"])("falls back to the dashboard for %s", (from) => {
    expect(movedTargetUrl(from)).toBe(`${MOVED_TO_ORIGIN}/dashboard`);
  });
});
