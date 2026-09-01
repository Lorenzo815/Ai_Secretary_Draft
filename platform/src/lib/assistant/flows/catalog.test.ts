import { describe, expect, it } from "vitest";
import { isAssistantToolKey } from "../tools/registry";
import { DEFAULT_FLOW_KEY, flowCatalog } from "./catalog";

describe("flow catalog", () => {
  it("has unique keys and a valid default", () => {
    const keys = flowCatalog.map((flow) => flow.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(DEFAULT_FLOW_KEY);
  });

  it("references only registered tools and catalog flows", () => {
    const keys = new Set(flowCatalog.map((flow) => flow.key));

    for (const flow of flowCatalog) {
      expect(flow.allowedTools.every(isAssistantToolKey)).toBe(true);
      expect(flow.allowedTransitions.every((key) => keys.has(key) && key !== flow.key)).toBe(true);
      expect(flow.lifecycle === "tool_cycle" || flow.allowedTools.length === 0).toBe(true);
    }
  });

  it("defines the approved intake and first-visit journey", () => {
    expect(flowCatalog.map((flow) => flow.key)).toEqual([
      "initial_triage",
      "collect_profile",
      "commercial_information",
      "payment_confirmation",
      "schedule_appointment",
    ]);

    const payment = flowCatalog.find((flow) => flow.key === "payment_confirmation");
    expect(payment?.allowedTools).toEqual(["payment.request_deposit"]);
    expect(payment?.allowedTransitions).toEqual([]);

    const scheduling = flowCatalog.find((flow) => flow.key === "schedule_appointment");
    expect(scheduling?.allowedTools).toEqual([
      "calendar.find_first_visit_option",
      "calendar.book_first_visit",
    ]);
    expect(scheduling?.prompt).toContain("optionId");
    expect(scheduling?.prompt).toContain("memória cumulativa");
    expect(scheduling?.prompt).toContain("Nunca pergunte novamente uma dimensão já respondida");
    expect(scheduling?.prompt).toContain("chame calendar.find_first_visit_option na mesma resposta");
    expect(scheduling?.prompt).toContain("significa preference=together");
    expect(scheduling?.prompt).toContain("use como fromDate a data local");
    expect(scheduling?.prompt).toContain("recalcule-a do zero");
    expect(scheduling?.prompt).toContain("nunca podem se contradizer");
    expect(scheduling?.prompt).toContain("sem incluir essa toolCall");
    expect(scheduling?.prompt).toContain("Exemplo semântico");
  });

  it("requires explicit questions and progressive commercial dialogue", () => {
    const triage = flowCatalog.find((flow) => flow.key === "initial_triage");
    const profile = flowCatalog.find((flow) => flow.key === "collect_profile");
    const commercial = flowCatalog.find((flow) => flow.key === "commercial_information");
    const payment = flowCatalog.find((flow) => flow.key === "payment_confirmation");

    expect(triage?.prompt).toContain("continueImmediately=false");
    expect(profile?.prompt).toContain("exatamente uma pergunta direta");
    expect(profile?.prompt).toContain("mesmo que outros campos continuem pendentes");
    expect(profile?.prompt).toContain("profile.missingFields retornado pela tool");
    expect(commercial?.prompt).toContain("Revele detalhes progressivamente");
    expect(commercial?.prompt).toContain("pergunta direta");
    expect(payment?.prompt).toContain("não peça a mesma confirmação duas vezes");
  });
});