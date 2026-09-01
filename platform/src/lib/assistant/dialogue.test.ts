import { describe, expect, it } from "vitest";
import { ensureExplicitNextQuestion, preventPrematureJourneyCompletion } from "./dialogue";

describe("assistant dialogue continuity", () => {
  it("turns a premature completed profile into the commercial transition", () => {
    expect(preventPrematureJourneyCompletion({
      decision: "reply",
      transition: { action: "complete" },
      flowKey: "collect_profile",
      relationshipStatus: "new",
      missingFields: [],
    })).toMatchObject({
      action: "transition",
      targetFlowKey: "commercial_information",
      continueImmediately: false,
    });
  });

  it("keeps a premature commercial completion active", () => {
    expect(preventPrematureJourneyCompletion({
      decision: "reply",
      transition: { action: "complete" },
      flowKey: "commercial_information",
      relationshipStatus: "new",
      missingFields: [],
    })).toMatchObject({ action: "stay", targetFlowKey: undefined });
  });

  it("adds the next profile question when a waiting reply ends vaguely", () => {
    const reply = ensureExplicitNextQuestion({
      reply: "Certo, seguimos com seu cadastro.",
      decision: "reply",
      transitionAction: "stay",
      flowKey: "collect_profile",
      missingFields: ["profession"],
    });

    expect(reply).toBe("Certo, seguimos com seu cadastro.\n\nPara concluir seu cadastro, qual é a sua profissão?");
  });

  it("does not duplicate an explicit final question", () => {
    const reply = "Qual é a sua profissão?";
    expect(ensureExplicitNextQuestion({
      reply,
      decision: "reply",
      transitionAction: "stay",
      flowKey: "collect_profile",
      missingFields: ["profession"],
    })).toBe(reply);
  });

  it("uses the destination flow question while transitioning", () => {
    const reply = ensureExplicitNextQuestion({
      reply: "Entendi, será sua primeira consulta.",
      decision: "reply",
      transitionAction: "transition",
      targetFlowKey: "collect_profile",
      flowKey: "initial_triage",
      missingFields: ["fullName"],
    });

    expect(reply).toContain("qual é o seu nome completo?");
    expect(reply).not.toContain("paciente de retorno");
  });

  it("does not append questions after a completed booking or operational error", () => {
    for (const toolResult of [
      JSON.stringify({ executedTools: ["calendar.book_first_visit"], results: [{ ok: true }] }),
      JSON.stringify({ executedTools: ["payment.request_deposit"], results: [{ ok: false, type: "operational_error" }] }),
    ]) {
      expect(ensureExplicitNextQuestion({
        reply: "A equipe dará continuidade.",
        decision: "reply",
        transitionAction: "stay",
        flowKey: "payment_confirmation",
        missingFields: [],
        toolResult,
      })).toBe("A equipe dará continuidade.");
    }
  });
});