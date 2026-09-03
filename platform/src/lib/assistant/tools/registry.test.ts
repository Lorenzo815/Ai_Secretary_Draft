import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration } from "../agent/defaults";
import { buildAgentActionSchema } from "../agent/schema";
import { getGroundedToolReply } from "./execution";
import { isAssistantToolKey, listToolMetadata, toolRegistry } from "./registry";

describe("tool registry", () => {
  it("derives public metadata from every registered tool", () => {
    const metadata = listToolMetadata();

    expect(metadata.map((tool) => tool.key)).toEqual(Object.keys(toolRegistry));
    expect(metadata.every((tool) => tool.label && tool.description)).toBe(true);
    expect(metadata.find((tool) => tool.key === "calendar.book_plan_option")?.mutates).toBe(true);
    expect(isAssistantToolKey("calendar.find_plan_option")).toBe(true);
    expect(isAssistantToolKey("calendar.find_first_visit_option")).toBe(false);
  });

  it("requires strict independent criteria for generic plan steps", () => {
    const schema = toolRegistry["calendar.find_plan_option"].argumentsSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: { criteria: { items: { required: string[]; additionalProperties: boolean } } };
    };

    expect(schema.required).toEqual(["planKey", "preference", "criteria"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.criteria.items.required).toEqual([
      "stepKey", "dateIntent", "fromDate", "toDate", "period", "startTime",
    ]);
    expect(schema.properties.criteria.items.additionalProperties).toBe(false);
  });

  it("offers exactly one tool request or one final response", () => {
    const configuration = createDefaultAgentConfiguration();
    const iterative = buildAgentActionSchema(configuration, true) as { anyOf: unknown[] };
    const final = buildAgentActionSchema(configuration, false) as { properties: { type: { enum: string[] } } };

    expect(iterative.anyOf).toHaveLength(2);
    expect(final.properties.type.enum).toEqual(["final"]);
  });

  it("renders grounded replies for arbitrary configured plan steps", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.find_plan_option"],
      results: [{
        ok: true,
        tool: "calendar.find_plan_option",
        optionId: "option-1",
        planName: "Atendimento inicial",
        timezone: "America/Sao_Paulo",
        steps: [
          { label: "Avaliação", startAt: "2026-09-04T09:00:00-03:00" },
          { label: "Consulta", startAt: "2026-09-04T09:30:00-03:00" },
        ],
      }],
    }));

    expect(reply).toContain("Atendimento inicial");
    expect(reply).toContain("Avaliação");
    expect(reply).toContain("Consulta");
  });
});