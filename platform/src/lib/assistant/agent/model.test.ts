import { describe, expect, it, vi } from "vitest";

vi.mock("../../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        createIndex: vi.fn(),
        insertOne: vi.fn(),
        updateOne: vi.fn(),
      }),
    }),
  }),
}));

import { parseAgentAction } from "./model";

describe("parseAgentAction", () => {
  it("parses compact serialized tool arguments", () => {
    const action = parseAgentAction(JSON.stringify({
      action: {
        type: "tool_request",
        reasonCode: "persist_customer_data",
        toolCall: {
          name: "customer.update_profile",
          argumentsJson: JSON.stringify({ fullName: "Lorenzo Puppi", cpf: null }),
        },
      },
    }));

    expect(action).toEqual({
      type: "tool_request",
      reasonCode: "persist_customer_data",
      toolCall: {
        tool: "customer.update_profile",
        arguments: { fullName: "Lorenzo Puppi", cpf: null },
      },
    });
  });

  it("accepts legacy object arguments during rollout", () => {
    const action = parseAgentAction(JSON.stringify({
      action: {
        type: "tool_request",
        reasonCode: "need_authoritative_data",
        toolCall: {
          name: "calendar.find_slots",
          arguments: { purpose: "book", eventType: "doctor_consultation" },
        },
      },
    }));

    expect(action.type).toBe("tool_request");
    if (action.type === "tool_request") {
      expect(action.toolCall.arguments).toEqual({
        purpose: "book",
        eventType: "doctor_consultation",
      });
    }
  });

  it("rejects malformed serialized tool arguments", () => {
    expect(() => parseAgentAction(JSON.stringify({
      action: {
        type: "tool_request",
        reasonCode: "need_authoritative_data",
        toolCall: {
          name: "calendar.find_slots",
          argumentsJson: "{",
        },
      },
    }))).toThrow("O agente retornou uma solicitação de ferramenta inválida.");
  });
});
