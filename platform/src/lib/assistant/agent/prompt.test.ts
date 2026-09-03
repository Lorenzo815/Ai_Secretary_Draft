import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration } from "./defaults";
import { AGENT_STRUCTURAL_POLICY, buildAgentDeveloperPrompt } from "./prompt";

describe("assistant commercial conduct", () => {
  it("connects the customer's goal to value and recommends a next step", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(prompt).toContain("conecte esse objetivo a um ou dois diferenciais autorizados");
    expect(prompt).toContain("recomende-o diretamente");
    expect(prompt).toContain("próximo passo de baixo atrito");
  });

  it("persuades without pressure, artificial urgency, or clinical promises", () => {
    const prompt = buildAgentDeveloperPrompt(createDefaultAgentConfiguration(), false);

    expect(prompt).toContain("não faça pressão comercial");
    expect(prompt).toContain("não crie urgência ou escassez artificial");
    expect(prompt).toContain("não prometa resultados clínicos");
    expect(AGENT_STRUCTURAL_POLICY).toContain("Nunca manipule emoções");
  });

  it("does not recommend competing clinics", () => {
    expect(AGENT_STRUCTURAL_POLICY).toContain("Não recomende, cite ou compare outras clínicas");
    expect(AGENT_STRUCTURAL_POLICY).toContain("Trate pedidos por concorrentes como type=reply");
  });

  it("tries authorized actions before a real human handoff", () => {
    const configuration = createDefaultAgentConfiguration();

    expect(configuration.handoffPolicy).toContain("use as fontes e ferramentas disponíveis antes de encaminhar");
    expect(configuration.handoffPolicy).toContain("Nunca diga que encaminhou sem registrar de fato");
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

    expect(AGENT_STRUCTURAL_POLICY).toContain("calendar.find_slots com purpose=reschedule");
    expect(AGENT_STRUCTURAL_POLICY).toContain("Não cancele nem exclua agendamentos");
    expect(prompt).toContain("aceitam somente candidateId emitido por calendar.find_slots");
    expect(prompt).toContain("Nunca chame calendar.book antes ou depois");
    expect(prompt).toContain("Pedido apenas para cancelar deve usar human_handoff");
  });

  it("supports legacy configurations without tool guidance", () => {
    const configuration = createDefaultAgentConfiguration();
    delete (configuration as Partial<typeof configuration>).toolGuidance;

    expect(() => buildAgentDeveloperPrompt(configuration, false)).not.toThrow();
    expect(buildAgentDeveloperPrompt(configuration, false)).toContain("calendar.find_slots:");
  });

  it("allows corrected retries with expanded execution budgets", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(configuration.loopPolicy).toEqual({
      maxModelIterations: 8,
      maxToolExecutions: 6,
      maxMutations: 4,
      maxRepeatedInvalidCalls: 2,
    });
    expect(prompt).toContain("use o erro retornado para corrigir os argumentos");
    expect(prompt).toContain("Nunca execute outro candidato como alternativa");
  });
});