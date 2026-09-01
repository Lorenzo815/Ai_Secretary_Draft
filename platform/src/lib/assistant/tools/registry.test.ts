import { describe, expect, it } from "vitest";
import { buildAssistantResponseSchema } from "../schema";
import type { FlowVersion } from "../flows/contracts";
import { assertRequiredToolCall, getGroundedToolReply, getToolValidationRecoveryReply, hasSuccessfulToolResult } from "./execution";
import { isAssistantToolKey, listToolMetadata, toolRegistry } from "./registry";

const baseVersion: FlowVersion = {
  version: 1,
  prompt: "Test",
  lifecycle: "tool_cycle",
  preToolPrompt: "Test",
  postToolPrompt: "Test",
  allowedTools: ["calendar.list_appointments", "calendar.book_appointment"],
  knowledgeContext: "Test",
  completionCriteria: "Test",
  allowedTransitions: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("tool registry", () => {
  it("derives public metadata from every registered tool", () => {
    const metadata = listToolMetadata();

    expect(metadata.map((tool) => tool.key)).toEqual(Object.keys(toolRegistry));
    expect(metadata.every((tool) => tool.label && tool.description)).toBe(true);
    expect(metadata.find((tool) => tool.key === "calendar.book_appointment")?.mutates).toBe(true);
    expect(isAssistantToolKey("calendar.list_appointments")).toBe(true);
    expect(isAssistantToolKey("calendar.delete_appointment")).toBe(false);
    expect(toolRegistry["calendar.find_first_visit_option"].promptInstructions).toContain("YYYY-MM-DD");
    expect(toolRegistry["calendar.find_first_visit_option"].promptInstructions).toContain("não uma espera");
    expect(toolRegistry["customer.update_profile"].promptInstructions).toContain("mesmo que outros campos");
  });

  it("builds pre-tool schema only from tools allowed by the flow", () => {
    const schema = buildAssistantResponseSchema(baseVersion, "pre_tool") as {
      properties: { toolCalls: { maxItems: number; items: { anyOf: Array<{ properties: { tool: { enum: string[] } } }> } } };
    };
    const keys = schema.properties.toolCalls.items.anyOf.map((entry) => entry.properties.tool.enum[0]);

    expect(schema.properties.toolCalls.maxItems).toBe(2);
    expect(keys).toEqual(["calendar.list_appointments", "calendar.book_appointment"]);
  });

  it("forbids tool calls after execution and in single-call flows", () => {
    for (const phase of ["post_tool", "single"] as const) {
      const schema = buildAssistantResponseSchema(baseVersion, phase) as {
        properties: { toolCalls: { maxItems: number } };
      };
      expect(schema.properties.toolCalls.maxItems).toBe(0);
    }
  });

  it("grounds customer input errors without another tool attempt", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["customer.update_profile"],
      results: [{
        ok: false,
        type: "customer_input_error",
        publicReply: "O CPF informado parece inválido. Pode conferir os 11 dígitos e me enviar novamente?",
      }],
    }));

    expect(reply).toBe("O CPF informado parece inválido. Pode conferir os 11 dígitos e me enviar novamente?");
  });

  it("recovers deterministically when tool correction attempts are exhausted", () => {
    expect(getToolValidationRecoveryReply("initial_triage")).toContain("primeira consulta");
    expect(getToolValidationRecoveryReply("collect_profile")).toContain("enviar novamente");
    expect(getToolValidationRecoveryReply("payment_confirmation")).toContain("confirmação");
    expect(getToolValidationRecoveryReply("schedule_appointment")).toContain("horários separados");
  });

  it("requires tools for ungrounded completion and accepts persisted completion", () => {
    const generation = {
      decision: "reply" as const,
      reply: "Tudo certo.",
      updatedSummary: "Concluído.",
      state: { stage: "concluido", collectedData: [], missingData: [], notes: [] },
      transition: { action: "complete" as const, continueImmediately: false },
      toolCalls: [],
    };

    expect(assertRequiredToolCall({
      generation,
      allowedTools: ["calendar.book_first_visit"],
    })).not.toBeNull();
    expect(assertRequiredToolCall({
      generation,
      allowedTools: ["calendar.book_first_visit"],
      completionIsGrounded: true,
    })).toBeNull();
  });

  it("recognizes only a successful matching terminal tool result", () => {
    const output = JSON.stringify({
      executedTools: ["calendar.book_first_visit"],
      results: [{ ok: true }],
    });
    expect(hasSuccessfulToolResult(output, "calendar.book_first_visit")).toBe(true);
    expect(hasSuccessfulToolResult(output, "calendar.book_appointment")).toBe(false);
  });
});