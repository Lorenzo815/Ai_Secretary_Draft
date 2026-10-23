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
    expect(isAssistantToolKey("calendar.list_appointments")).toBe(true);
    expect(isAssistantToolKey("calendar.find_plan_option")).toBe(false);
  });

  it("exposes upcoming appointment lookup as an enabled, no-argument read-only tool", () => {
    const definition = toolRegistry["calendar.list_appointments"];

    expect(definition.mutates).toBe(false);
    expect(definition.argumentsSchema).toEqual({
      type: "object", additionalProperties: false, required: [], properties: {},
    });
    expect(createDefaultAgentConfiguration().enabledTools).toContain("calendar.list_appointments");
    expect(listToolMetadata()).toContainEqual(expect.objectContaining({
      key: "calendar.list_appointments", label: "Consultar meus agendamentos", mutates: false,
    }));
  });

  it("keeps appointment lookup separate from the confirmed rescheduling flow", () => {
    const instructions = toolRegistry["calendar.list_appointments"].promptInstructions;

    expect(instructions).toContain("purpose=reschedule");
    expect(instructions).toContain("calendar.reschedule uma única vez");
    expect(instructions).toContain("calendar.hold, payment.request_deposit ou calendar.book");
    expect(instructions).toContain("hasMore=true");
    expect(toolRegistry["calendar.reschedule"].promptInstructions).toContain("não substitui a busca");
  });

  it("distinguishes read visibility, attendance confirmation and live holds from mutation authorization", () => {
    const instructions = toolRegistry["calendar.list_appointments"].promptInstructions;
    expect(instructions).toContain("confirmationStatus");
    expect(instructions).toContain("withinAgentSchedulingScope");
    expect(instructions).toContain("holdExpiresAt");
    expect(toolRegistry["calendar.reschedule"].promptInstructions).toContain("aguardando sinal");
    expect(toolRegistry["calendar.reschedule"].promptInstructions).toContain("não exige os pré-requisitos de confirmação definitiva");
  });

  it("keeps operating windows and customer identity out of search arguments", () => {
    const schema = toolRegistry["calendar.find_slots"].argumentsSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };

    expect(schema.required).toEqual([
      "purpose", "eventType", "planKey", "dateIntent", "fromDate", "horizonDays", "period", "preferredTime", "ranking", "candidateCount", "stepCriteria",
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).not.toHaveProperty("timeWindow");
    expect(schema.properties).not.toHaveProperty("toDate");
    expect(schema.properties).not.toHaveProperty("customerId");
  });

  it("supports different customer constraints for each plan step", () => {
    const schema = toolRegistry["calendar.find_slots"].argumentsSchema as {
      properties: {
        horizonDays: { maximum: number };
        stepCriteria: { maxItems: number; items: { required: string[]; properties: Record<string, unknown> } };
      };
    };

    expect(schema.properties.horizonDays.maximum).toBe(60);
    expect(schema.properties.stepCriteria.maxItems).toBe(10);
    expect(schema.properties.stepCriteria.items.required).toEqual([
      "stepKey", "dateIntent", "fromDate", "horizonDays", "period", "startTime",
    ]);
    expect(schema.properties.stepCriteria.items.properties).not.toHaveProperty("timeWindow");
  });

  it("searches autonomously but requires confirmation for calendar mutations", () => {
    const searchInstructions = toolRegistry["calendar.find_slots"].promptInstructions;

    expect(searchInstructions).toContain("execute-a imediatamente");
    expect(searchInstructions).toContain("Confirmação explícita é exigida somente antes");
    expect(searchInstructions).toContain("não para visualizar disponibilidade");
    expect(searchInstructions).toContain("reserva temporária antes do sinal");
  });

  it("offers complementary reads without requiring appointment lookup before rescheduling", () => {
    const lookup = toolRegistry["calendar.list_appointments"].promptInstructions;
    const search = toolRegistry["calendar.find_slots"].promptInstructions;

    expect(lookup).toContain("Vários compromissos na listagem não são um erro");
    expect(search).toContain("calendar.list_appointments é opcional");
    expect(search).toContain("vincula esse alvo aos candidatos");
    expect(search).toContain("currentAppointments");
    expect(search).toContain("Não escolha eventos pela posição");
  });

  it("respects whole-plan policies when describing searches for mixed extremes", () => {
    const instructions = toolRegistry["calendar.find_slots"].promptInstructions;

    expect(instructions).toContain("Quando buscas avulsas forem permitidas");
    expect(instructions).toContain("em vez de pesquisar etapas isoladas");
  });

  it("uses the server hold expiry and does not book an automatically promoted hold", () => {
    expect(toolRegistry["calendar.hold"].promptInstructions).toContain("holdExpiresAt");
    expect(toolRegistry["calendar.hold"].promptInstructions).toContain("não aceita candidatos de eventos avulsos");
    expect(toolRegistry["calendar.hold"].promptInstructions).not.toContain("24 horas");
    expect(toolRegistry["calendar.book"].promptInstructions).toContain("promove essa reserva automaticamente");
    expect(toolRegistry["calendar.reschedule"].promptInstructions).toContain("não autoriza criar uma cobrança");
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

  it("collects related profile fields in manageable groups", () => {
    const instructions = toolRegistry["customer.update_profile"].promptInstructions;

    expect(instructions).toContain("campos relacionados");
    expect(instructions).toContain("dois ou três campos");
    expect(instructions).not.toContain("Pergunte um tópico por vez");
    expect(instructions).toContain("runtime.customer.configuredMissingFields");
    expect(instructions).toContain("[] em secondaryPhones");
    expect(toolRegistry["customer.classify_relationship"].promptInstructions).toContain("não execute as duas ferramentas");
    expect(toolRegistry["customer.classify_relationship"].promptInstructions).toContain("Classificar retorno não implica encaminhamento humano");
    expect(toolRegistry["customer.update_profile"].promptInstructions).toContain("relationshipRouting");
  });

  it("accepts payer email for automatic Pix creation", () => {
    const schema = toolRegistry["payment.request_deposit"].argumentsSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["confirmedByCustomer", "payerEmail"]);
    expect(schema.properties).toHaveProperty("payerEmail");
    expect(toolRegistry["payment.request_deposit"].promptInstructions).toContain("runtime.operations.paymentProvider");
    expect(toolRegistry["payment.request_deposit"].promptInstructions).toContain("não é necessário já ter pago");
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

  it("handles mixed per-step extremes without trusting a limited candidate batch", () => {
    const instructions = toolRegistry["calendar.find_slots"].promptInstructions;

    expect(instructions).toContain("isChronologicallyEarliest");
    expect(instructions).toContain("isChronologicallyLatest");
    expect(instructions).toContain("extremos opostos em etapas diferentes");
    expect(instructions).toContain("primeira avaliação + última consulta");
    expect(instructions).toContain("comparam somente o lote limitado");
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

  it("does not replace the model response with a slot-search template", () => {
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

    expect(reply).toBeNull();
  });

  it.each([
    "calendar.find_plan_option",
    "calendar.book_plan_option",
    "calendar.check_availability",
    "calendar.book_appointment",
    "calendar.update_appointment",
  ])("does not render a legacy grounded reply for %s", (tool) => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: [tool],
      results: [{ ok: true, tool, startAt: "2026-09-04T09:00:00-03:00" }],
    }));

    expect(reply).toBeNull();
  });

  it("reports calendar failures without promising an unregistered handoff", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.find_slots"],
      results: [{
        ok: false,
        tool: "calendar.find_slots",
        type: "operational_error",
      }],
    }));

    expect(reply).toContain("Não consegui consultar a agenda");
    expect(reply).not.toContain("equipe");
  });

  it("describes a moved hold as temporary and still awaiting payment rather than a confirmed booking", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.reschedule"],
      results: [{
        ok: true, tool: "calendar.reschedule", status: "held", timezone: "America/Sao_Paulo",
        holdExpiresAt: "2026-10-23T18:00:00Z",
        steps: [{ label: "Consulta", startAt: "2026-10-26T19:00:00Z" }],
      }],
    }));

    expect(reply).toContain("reserva temporária");
    expect(reply).toContain("aguardando o sinal");
    expect(reply).toContain("vence em");
    expect(reply).toContain("23/10/2026");
    expect(reply).not.toContain("confirmado");
  });

  it("reports payment failures without claiming a handoff was already registered", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["payment.request_deposit"],
      results: [{ ok: false, type: "operational_error" }],
    }));

    expect(reply).toContain("não consigo gerar os dados do sinal");
    expect(reply).not.toContain("Encaminhei");
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

  it("keeps successful booking confirmations grounded in server data", () => {
    const reply = getGroundedToolReply(JSON.stringify({
      executedTools: ["calendar.book"],
      results: [{
        ok: true,
        tool: "calendar.book",
        timezone: "America/Sao_Paulo",
        steps: [
          { label: "Consulta", startAt: "2026-09-08T09:30:00-03:00" },
        ],
      }],
    }));

    expect(reply).toContain("Seu agendamento foi confirmado");
    expect(reply).toContain("Consulta");
  });
});