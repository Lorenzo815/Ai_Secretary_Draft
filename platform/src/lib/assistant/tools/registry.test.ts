import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration } from "../agent/defaults";
import { buildAgentActionSchema } from "../agent/schema";
import { getGroundedToolReply, wasToolSuccessfullyExecuted } from "./execution";
import { isAssistantToolKey, listToolMetadata, toolRegistry } from "./registry";

describe("tool registry", () => {
  it("derives public metadata from every registered tool", () => {
    const metadata = listToolMetadata();

    expect(metadata.map((tool) => tool.key)).toEqual(Object.keys(toolRegistry));
    expect(metadata.every((tool) => tool.label && tool.description)).toBe(true);
    expect(metadata.find((tool) => tool.key === "calendar.book")?.mutates).toBe(true);
    expect(metadata.find((tool) => tool.key === "calendar.reschedule")?.mutates).toBe(true);
    expect(isAssistantToolKey("calendar.find_slots")).toBe(true);
    expect(isAssistantToolKey("calendar.find_plan_option")).toBe(false);
  });

  it("keeps operating windows and customer identity out of search arguments", () => {
    const schema = toolRegistry["calendar.find_slots"].argumentsSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };

    expect(schema.required).toEqual([
      "purpose", "eventType", "planKey", "dateIntent", "fromDate", "horizonDays", "period", "preferredTime", "ranking", "candidateCount",
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).not.toHaveProperty("timeWindow");
    expect(schema.properties).not.toHaveProperty("toDate");
    expect(schema.properties).not.toHaveProperty("customerId");
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

  it.each(["calendar.book", "calendar.reschedule"] as const)("confirms %s from one server candidate", (key) => {
    const schema = toolRegistry[key].argumentsSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };

    expect(schema.required).toEqual(["candidateId", "confirmedByCustomer"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).not.toHaveProperty("appointmentId");
    expect(schema.properties).not.toHaveProperty("customerId");
  });

  it("distinguishes displayed positions from chronological availability", () => {
    const instructions = toolRegistry["calendar.find_slots"].promptInstructions;

    expect(instructions).toContain("isChronologicallyEarliest");
    expect(instructions).toContain("isChronologicallyLatest");
    expect(instructions).toContain("independentemente da ordem de ranking ou de exibição");
  });

  it("offers exactly one tool request or one final response", () => {
    const configuration = createDefaultAgentConfiguration();
    const iterative = buildAgentActionSchema(configuration, true) as unknown as {
      properties: { action: { anyOf: unknown[] } };
    };
    const final = buildAgentActionSchema(configuration, false) as unknown as {
      properties: { action: { properties: { type: { enum: string[] } } } };
    };

    expect(iterative.properties.action.anyOf).toHaveLength(2);
    expect(final.properties.action.properties.type.enum).toEqual(["final"]);
  });

  it("renders ranked candidates with arbitrary configured plan steps", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.find_slots"],
      results: [{
        ok: true,
        tool: "calendar.find_slots",
        timezone: "America/Sao_Paulo",
        candidates: [{ steps: [
          { label: "Avaliação", startAt: "2026-09-04T09:00:00-03:00", weekdayLabel: "sexta-feira" },
          { label: "Consulta", startAt: "2026-09-04T09:30:00-03:00", weekdayLabel: "sexta-feira" },
        ] }],
      }],
    }));

    expect(reply).toContain("Avaliação");
    expect(reply).toContain(" e Consulta");
    expect(reply).toContain("sexta-feira");
  });

  it("shows at most two schedule options as bullets", () => {
    const candidate = (hour: string) => ({ steps: [
      { label: "Consulta", startAt: `2026-09-04T${hour}:00:00-03:00` },
    ] });
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.find_slots"],
      results: [{
        ok: true,
        tool: "calendar.find_slots",
        timezone: "America/Sao_Paulo",
        candidates: [candidate("09"), candidate("10"), candidate("11")],
      }],
    }));

    expect(reply).toContain("- Opção 1:");
    expect(reply).toContain("- Opção 2:");
    expect(reply).not.toContain("Opção 3");
    expect(reply).not.toContain("11:00");
  });

  it("counts only a successful tool result as executed", () => {
    const success = JSON.stringify({ executedTools: ["calendar.reschedule"], results: [{ ok: true }] });
    const failure = JSON.stringify({ executedTools: ["calendar.reschedule"], results: [{ ok: false }] });

    expect(wasToolSuccessfullyExecuted(success, "calendar.reschedule")).toBe(true);
    expect(wasToolSuccessfullyExecuted(failure, "calendar.reschedule")).toBe(false);
    expect(wasToolSuccessfullyExecuted("invalid", "calendar.reschedule")).toBe(false);
  });

  it("renders every event changed by an atomic reschedule", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.reschedule"],
      results: [{
        ok: true,
        tool: "calendar.reschedule",
        timezone: "America/Sao_Paulo",
        steps: [
          { label: "Bioimpedância", startAt: "2026-09-08T09:00:00-03:00" },
          { label: "Consulta Dr.", startAt: "2026-09-08T09:30:00-03:00" },
        ],
      }],
    }));

    expect(reply).toContain("Bioimpedância");
    expect(reply).toContain(" e Consulta Dr.");
  });
});