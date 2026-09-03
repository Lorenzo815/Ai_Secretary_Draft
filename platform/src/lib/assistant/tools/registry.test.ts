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

  it("can persist an explicit relationship with the customer profile", () => {
    const schema = toolRegistry["customer.update_profile"].argumentsSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };

    expect(schema.required).toContain("relationshipStatus");
    expect(schema.required).toContain("relationshipConfirmedByCustomer");
    expect(schema.properties).toHaveProperty("relationshipStatus");
  });

  it("updates every confirmed appointment in one strict mutation", () => {
    const schema = toolRegistry["calendar.update_appointment"].argumentsSchema as {
      required: string[];
      properties: { appointments: { maxItems: number; items: { required: string[]; additionalProperties: boolean } } };
    };

    expect(schema.required).toEqual(["appointments", "confirmedByCustomer"]);
    expect(schema.properties.appointments.maxItems).toBe(10);
    expect(schema.properties.appointments.items.required).toEqual(["appointmentId", "startAt", "eventType", "notes"]);
    expect(schema.properties.appointments.items.additionalProperties).toBe(false);
  });

  it("offers exactly one tool request or one final response", () => {
    const configuration = createDefaultAgentConfiguration();
    const iterative = buildAgentActionSchema(configuration, true) as {
      properties: { action: { anyOf: unknown[] } };
    };
    const final = buildAgentActionSchema(configuration, false) as {
      properties: { action: { properties: { type: { enum: string[] } } } };
    };

    expect(iterative.properties.action.anyOf).toHaveLength(2);
    expect(final.properties.action.properties.type.enum).toEqual(["final"]);
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
    expect(reply).toContain(" e Consulta");
  });

  it("renders every event changed by a batch reschedule", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.update_appointment"],
      results: [{
        ok: true,
        tool: "calendar.update_appointment",
        timezone: "America/Sao_Paulo",
        appointments: [
          { eventTypeName: "Bioimpedância", startAt: "2026-09-08T09:00:00-03:00" },
          { eventTypeName: "Consulta Dr.", startAt: "2026-09-08T09:30:00-03:00" },
        ],
      }],
    }));

    expect(reply).toContain("Bioimpedância");
    expect(reply).toContain(" e Consulta Dr.");
  });
});