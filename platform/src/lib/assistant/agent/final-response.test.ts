import { describe, expect, it } from "vitest";
import type { AgentFinalResponse } from "./contracts";
import { getAgentFinalMessage } from "./final-response";

function createResponse(overrides: Partial<AgentFinalResponse> = {}): AgentFinalResponse {
  return {
    type: "final",
    decision: "reply",
    message: "Ótimo! Me conta rapidinho o que você busca com o acompanhamento...",
    groundingResultIds: [],
    memory: {
      summary: "Cliente interessado em acompanhamento.",
      pendingQuestion: "O que o cliente busca com o acompanhamento?",
      nonSensitiveFacts: [],
    },
    ...overrides,
  };
}

describe("getAgentFinalMessage", () => {
  it("sends only the model message without appending the pending memory question", () => {
    const message = getAgentFinalMessage(createResponse());

    expect(message).toBe("Ótimo! Me conta rapidinho o que você busca com o acompanhamento...");
    expect(message).not.toContain("O que o cliente busca com o acompanhamento?");
  });

  it("still rejects an empty model message", () => {
    expect(() => getAgentFinalMessage(createResponse({ message: "  " }))).toThrow(
      "O agente retornou uma mensagem final vazia.",
    );
  });
});
