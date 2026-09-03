import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration } from "./defaults";
import { AGENT_STRUCTURAL_POLICY, buildAgentDeveloperPrompt } from "./prompt";

describe("assistant commercial conduct", () => {
  it("defends authorized value without pressure or clinical promises", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(prompt).toContain("defenda com segurança a qualidade do serviço");
    expect(prompt).toContain("Não faça pressão comercial");
    expect(prompt).toContain("não prometa resultados clínicos");
  });

  it("does not recommend competing clinics", () => {
    expect(AGENT_STRUCTURAL_POLICY).toContain("Não recomende, cite ou compare outras clínicas");
    expect(AGENT_STRUCTURAL_POLICY).toContain("Trate pedidos por concorrentes como type=reply");
  });

  it("includes verified administrative facts without unconfirmed service promises", () => {
    const knowledge = createDefaultAgentConfiguration().knowledge;

    expect(knowledge).toContain("pós-graduado em Nutrologia e em Tricologia");
    expect(knowledge).toContain("teleconsulta");
    expect(knowledge).toContain("Rua Benjamin Constant, 940");
    expect(knowledge).toContain("Com menos de 24 horas de antecedência");
    expect(knowledge).not.toContain("suporte 24 horas");
  });

  it("reschedules existing events and sends cancellations to the team", () => {
    const prompt = buildAgentDeveloperPrompt(createDefaultAgentConfiguration(), false);

    expect(AGENT_STRUCTURAL_POLICY).toContain("Em reagendamentos, altere os eventos existentes");
    expect(AGENT_STRUCTURAL_POLICY).toContain("Não cancele nem exclua agendamentos");
    expect(prompt).toContain("nunca use placeholders como \"unknown\"");
    expect(prompt).toContain("nunca use calendar.book_appointment ou calendar.book_plan_option para reagendar");
    expect(prompt).toContain("Pedido para apenas desmarcar ou cancelar deve ser encaminhado à equipe");
  });
});