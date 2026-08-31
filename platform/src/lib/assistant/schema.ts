import type { FlowVersion } from "./flows";

export type AssistantCallPhase = "single" | "pre_tool" | "post_tool";

export function buildAssistantResponseSchema(version: FlowVersion, phase: AssistantCallPhase) {
  const calendarActions = phase === "pre_tool"
    ? [
        "none",
        ...(version.allowedTools.includes("calendar.check_availability") ? ["check_availability"] : []),
        ...(version.allowedTools.includes("calendar.book_appointment") ? ["book_appointment"] : []),
      ]
    : ["none"];

  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reply", "updatedSummary", "state", "transition", "calendarAction"],
    properties: {
      decision: { type: "string", enum: ["reply", "out_of_scope", "emergency", "human_handoff"] },
      reply: { type: "string" },
      updatedSummary: { type: "string" },
      state: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "collectedData", "missingData", "notes"],
        properties: {
          stage: { type: "string" },
          collectedData: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: {
                key: { type: "string" },
                value: { type: "string" },
              },
            },
          },
          missingData: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
      },
      transition: {
        type: "object",
        additionalProperties: false,
        required: ["action", "continueImmediately", "targetFlowKey", "reasonCode", "reason"],
        properties: {
          action: { type: "string", enum: ["stay", "complete", "transition"] },
          continueImmediately: { type: "boolean" },
          targetFlowKey: { type: ["string", "null"] },
          reasonCode: { type: ["string", "null"] },
          reason: { type: ["string", "null"] },
        },
      },
      calendarAction: {
        type: "object",
        additionalProperties: false,
        required: ["action", "dateIntent", "fromDate", "toDate", "period", "startAt", "confirmedByCustomer", "notes"],
        properties: {
          action: { type: "string", enum: calendarActions },
          dateIntent: { type: ["string", "null"], enum: ["exact_date", "date_range", "next_available", null] },
          fromDate: { type: ["string", "null"] },
          toDate: { type: ["string", "null"] },
          period: { type: ["string", "null"], enum: ["morning", "afternoon", "any", null] },
          startAt: { type: ["string", "null"] },
          confirmedByCustomer: { type: "boolean" },
          notes: { type: ["string", "null"] },
        },
      },
    },
  };
}
