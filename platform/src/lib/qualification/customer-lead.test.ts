import { describe, expect, it } from "vitest";
import { buildQualificationSourceHash } from "./source-hash";

describe("qualification source hash", () => {
  it("changes when the active prompt configuration changes", () => {
    const input = { conversation: [{ direction: "inbound", text: "Olá" }] };

    expect(buildQualificationSourceHash(input, "config-a"))
      .not.toBe(buildQualificationSourceHash(input, "config-b"));
  });

  it("is stable for the same input and configuration", () => {
    const input = { conversation: [{ direction: "inbound", text: "Olá" }] };

    expect(buildQualificationSourceHash(input, "config-a"))
      .toBe(buildQualificationSourceHash(input, "config-a"));
  });
});