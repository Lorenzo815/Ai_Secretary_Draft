import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createDefaultAgentConfiguration } from "./defaults";
import { AGENT_STRUCTURAL_POLICY, buildAgentDeveloperPrompt, buildAgentMessages } from "./prompt";

describe("assistant commercial conduct", () => {
  it("connects the customer's goal to value and recommends a next step", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(prompt).toContain("conecte esse objetivo a um ou dois diferenciais autorizados");
    expect(prompt).toContain("recomende-o diretamente");
    expect(prompt).toContain("próximo passo de baixo atrito");
  });

  it("qualifies the customer and presents relevant value before a requested price", () => {
    const prompt = buildAgentDeveloperPrompt(createDefaultAgentConfiguration(), false);

    expect(AGENT_STRUCTURAL_POLICY).toContain("não apresente valores de imediato");
    expect(AGENT_STRUCTURAL_POLICY).toContain("então informe, na mesma resposta, o preço solicitado");
    expect(prompt).toContain("Se o objetivo ainda estiver indefinido, faça somente uma pergunta curta de qualificação");
    expect(prompt).toContain("explique-os brevemente e informe o preço solicitado na mesma mensagem");
    expect(prompt).toContain("responda ao preço diretamente, sem repetir a qualificação");
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

  it("prefers consecutive first-visit steps without overriding the customer", () => {
    const plan = createDefaultAgentConfiguration().schedulingPlans[0];

    expect(plan.description).toContain("Prefira horários consecutivos");
    expect(plan.description).toContain("priorize a vontade dele");
    expect(plan.constraints).toEqual([{ type: "ordered", before: "assessment", after: "consultation" }]);
  });

  it("supports legacy configurations without tool guidance", () => {
    const configuration = createDefaultAgentConfiguration();
    delete (configuration as Partial<typeof configuration>).toolGuidance;

    expect(() => buildAgentDeveloperPrompt(configuration, false)).not.toThrow();
    expect(buildAgentDeveloperPrompt(configuration, false)).toContain("calendar.find_slots:");
  });

  it("allows corrected retries without artificial tool budgets", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(configuration.loopPolicy).toEqual({
      maxModelIterations: 8,
      maxRepeatedInvalidCalls: 2,
    });
    expect(prompt).toContain("use o erro retornado para corrigir os argumentos");
    expect(prompt).toContain("Nunca execute outro candidato como alternativa");
  });

  it("guides the ideal journey without blocking requested availability checks", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(prompt).toContain("JORNADA DO ATENDIMENTO:");
    expect(prompt).toContain("completar os dados cadastrais necessários");
    expect(prompt).toContain("consulte a disponibilidade real imediatamente");
    expect(prompt).toContain("a reserva só será confirmada depois dos pré-requisitos");
  });

  it("compiles response style separately from conversation policy", () => {
    const configuration = createDefaultAgentConfiguration();
    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(prompt).toContain("ESTILO DE RESPOSTA:");
    expect(prompt).toContain(configuration.responseStyle);
    expect(configuration.responseStyle).toContain("uma a três frases curtas");
  });

  it("preserves explicit availability constraints after an empty search", () => {
    const prompt = buildAgentDeveloperPrompt(createDefaultAgentConfiguration(), false);

    expect(prompt).toContain("zero candidatos não é falha técnica");
    expect(prompt).toContain("Não faça outra busca ampliando");
    expect(prompt).toContain("Nunca ofereça uma data anterior");
    expect(prompt).toContain("unavailability.cause=undetermined");
    expect(AGENT_STRUCTURAL_POLICY).toContain("Nunca atribua a ausência a uma etapa");
  });

  it("grounds follow-ups in recent evidence without exposing internal analysis", () => {
    const prompt = buildAgentDeveloperPrompt(createDefaultAgentConfiguration(), false);

    expect(prompt).toContain("runtime.execution.trigger=follow_up");
    expect(prompt).toContain("ofereça uma saída concreta para a possível fricção");
    expect(prompt).toContain("não pressione");
    expect(prompt).toContain("não mencione pontuação, qualificação, análise interna");
  });

  it("sends quoted context and transient WhatsApp images to the model", () => {
    const messages = buildAgentMessages({
      configuration: createDefaultAgentConfiguration(),
      runtime: {} as Parameters<typeof buildAgentMessages>[0]["runtime"],
      previousSummary: "Sem contexto anterior.",
      toolHistory: [],
      finalIteration: false,
      messages: [{
        _id: new ObjectId(),
        metaMessageId: "wamid.image",
        customerId: new ObjectId(),
        contactPhone: "5511999999999",
        direction: "inbound",
        type: "image",
        body: "Aqui está",
        status: "received",
        timestamp: new Date("2026-09-17T12:00:00Z"),
        updatedAt: new Date("2026-09-17T12:00:00Z"),
        media: {
          id: "media-123",
          mimeType: "image/jpeg",
          caption: "Aqui está",
          dataUrl: "data:image/jpeg;base64,aW1hZ2U=",
        },
        replyTo: {
          metaMessageId: "wamid.original",
          direction: "outbound",
          type: "text",
          body: "Envie uma foto.",
        },
      }],
    });

    const userMessage = messages[2];
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toEqual(expect.arrayContaining([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,aW1hZ2U=", detail: "low" } },
    ]));
    const text = Array.isArray(userMessage.content)
      ? userMessage.content.find((part) => part.type === "text")?.text
      : "";
    expect(text).toContain("wamid.original");
    expect(text).toContain("Envie uma foto.");
    expect(text).not.toContain("data:image/jpeg");
  });

  it("includes an audio transcription in the trusted conversation payload", () => {
    const messages = buildAgentMessages({
      configuration: createDefaultAgentConfiguration(),
      runtime: {} as Parameters<typeof buildAgentMessages>[0]["runtime"],
      previousSummary: "Sem contexto anterior.",
      toolHistory: [],
      finalIteration: false,
      messages: [{
        _id: new ObjectId(),
        metaMessageId: "wamid.audio",
        customerId: new ObjectId(),
        contactPhone: "5511999999999",
        direction: "inbound",
        type: "audio",
        body: "[audio]",
        status: "received",
        timestamp: new Date("2026-10-04T12:00:00Z"),
        updatedAt: new Date("2026-10-04T12:00:00Z"),
        media: {
          id: "audio-123",
          mimeType: "audio/ogg",
          transcription: "Gostaria de marcar uma consulta.",
        },
      }],
    });

    const userMessage = messages[2];
    const text = Array.isArray(userMessage.content)
      ? userMessage.content.find((part) => part.type === "text")?.text
      : "";
    expect(text).toContain("Gostaria de marcar uma consulta.");
    expect(text).toContain("\"type\":\"audio\"");
  });

  it("instructs the model to answer event catalog questions from live runtime data", () => {
    const prompt = buildAgentDeveloperPrompt(createDefaultAgentConfiguration(), false);

    expect(prompt).toContain("runtime.clinic.eventTypes é o catálogo autorizado e autoritativo");
    expect(prompt).toContain("responda diretamente com esse catálogo sem chamar calendar.find_slots");
    expect(prompt).toContain("Uma pergunta sobre quais tipos existem não é uma consulta de horários");
    expect(prompt).toContain("não autoriza ignorar uma nova pergunta");
  });

  it("presents tool history as results rather than a conflicting output action shape", () => {
    const messages = buildAgentMessages({
      configuration: createDefaultAgentConfiguration(),
      runtime: {} as Parameters<typeof buildAgentMessages>[0]["runtime"],
      previousSummary: "Sem contexto anterior.",
      messages: [],
      toolHistory: [{
        resultId: "result-1",
        request: {
          type: "tool_request",
          reasonCode: "need_authoritative_data",
          toolCall: {
            tool: "calendar.find_slots",
            arguments: { purpose: "book", eventType: "doctor_consultation" },
          },
        },
        result: { ok: true },
      }],
      finalIteration: false,
    });
    const userMessage = messages[2];
    const text = Array.isArray(userMessage.content)
      ? userMessage.content.find((part) => part.type === "text")?.text ?? ""
      : "";
    const payload = JSON.parse(text) as {
      toolHistory: Array<Record<string, unknown>>;
    };

    expect(payload.toolHistory).toEqual([{
      resultId: "result-1",
      tool: "calendar.find_slots",
      arguments: { purpose: "book", eventType: "doctor_consultation" },
      result: { ok: true },
    }]);
    expect(payload.toolHistory[0]).not.toHaveProperty("request");
  });

  it("omits active plans that depend on hidden event types", () => {
    const configuration = createDefaultAgentConfiguration();
    configuration.bookableEventTypeKeys = ["doctor_consultation"];

    const prompt = buildAgentDeveloperPrompt(configuration, false);

    expect(prompt).not.toContain('"key":"first_visit"');
    expect(prompt).toContain("Tipos não presentes são deliberadamente ocultos");
  });
});