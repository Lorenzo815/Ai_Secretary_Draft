import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration } from "./defaults";
import { buildAgentActionSchema } from "./schema";

describe("buildAgentActionSchema", () => {
  it.each([true, false])("always produces an object root when tool requests are %s", (allowToolRequest) => {
    const schema = buildAgentActionSchema(createDefaultAgentConfiguration(), allowToolRequest);

    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["action"]);
    expect(schema.properties.action).toBeDefined();
  });

  it("uses a compact tool envelope instead of embedding every argument schema", () => {
    const schema = buildAgentActionSchema(createDefaultAgentConfiguration(), true);
    const serialized = JSON.stringify(schema);

    expect(serialized).toContain('"argumentsJson"');
    expect(serialized).not.toContain('"stepCriteria"');
    expect(serialized.length).toBeLessThan(3_000);
  });
});