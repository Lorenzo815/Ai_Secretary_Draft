import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOperationalEmbeddedSignupConfig, getWhatsAppConfig } = vi.hoisted(() => ({
  getOperationalEmbeddedSignupConfig: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));

vi.mock("./embedded-signup", () => ({ getOperationalEmbeddedSignupConfig }));
vi.mock("./client", () => ({ getWhatsAppConfig }));

import {
  createWhatsAppTemplate,
  getWhatsAppTemplateSendRequirements,
  listWhatsAppTemplates,
  validateWhatsAppTemplateSendParameters,
} from "./templates";

const config = {
  accessToken: "secret-business-token",
  phoneNumberId: "9988776655",
  businessAccountId: "1122334455",
  graphVersion: "v25.0",
};

describe("WhatsApp template management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getOperationalEmbeddedSignupConfig.mockResolvedValue(config);
    getWhatsAppConfig.mockReturnValue(null);
  });

  it("lists templates with the operational WABA token", async () => {
    const templates = [{
      id: "123",
      name: "lembrete_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Olá, {{1}}." }],
    }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: templates }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listWhatsAppTemplates()).resolves.toEqual(templates);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v25.0/1122334455/message_templates?"),
      expect.objectContaining({ headers: { Authorization: "Bearer secret-business-token" } }),
    );
  });

  it("creates a text template with one example per sequential variable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "456", status: "PENDING", category: "UTILITY" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createWhatsAppTemplate({
      name: " Lembrete_Agendamento ",
      language: "pt_BR",
      category: "UTILITY",
      body: "Olá, {{1}}. Seu atendimento será em {{2}}.",
      examples: ["Maria", "10/09/2026 às 14:30"],
    })).resolves.toMatchObject({ id: "456", status: "PENDING" });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      name: "lembrete_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      parameter_format: "positional",
      components: [{
        type: "BODY",
        text: "Olá, {{1}}. Seu atendimento será em {{2}}.",
        example: { body_text: [["Maria", "10/09/2026 às 14:30"]] },
      }],
    });
  });

  it("adds quick-reply buttons to the template payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "457", status: "PENDING", category: "UTILITY" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createWhatsAppTemplate({
      name: "confirmar_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Você confirma seu atendimento?",
      buttons: [
        { type: "QUICK_REPLY", text: "Confirmar" },
        { type: "QUICK_REPLY", text: "Alterar horário" },
      ],
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body)).components[1]).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Confirmar" },
        { type: "QUICK_REPLY", text: "Alterar horário" },
      ],
    });
  });

  it("normalizes phone and URL call-to-action buttons", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "458", status: "PENDING", category: "UTILITY" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createWhatsAppTemplate({
      name: "suporte_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Escolha uma opção de atendimento.",
      buttons: [
        { type: "PHONE_NUMBER", text: "Ligar", phoneNumber: "+55 (11) 99999-9999" },
        { type: "URL", text: "Abrir portal", url: "https://example.com/agenda" },
      ],
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body)).components[1]).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "PHONE_NUMBER", text: "Ligar", phone_number: "+5511999999999" },
        { type: "URL", text: "Abrir portal", url: "https://example.com/agenda" },
      ],
    });
  });

  it("preserves a dynamic URL placeholder and sends its required example", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "459", status: "PENDING", category: "UTILITY" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createWhatsAppTemplate({
      name: "acompanhar_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Acompanhe seu atendimento pelo botão abaixo.",
      buttons: [{
        type: "URL",
        text: "Acompanhar",
        url: "https://example.com/agenda/{{1}}",
        example: "consulta-123",
      }],
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body)).components[1]).toEqual({
      type: "BUTTONS",
      buttons: [{
        type: "URL",
        text: "Acompanhar",
        url: "https://example.com/agenda/{{1}}",
        example: ["consulta-123"],
      }],
    });
  });

  it("rejects a dynamic URL without an example", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createWhatsAppTemplate({
      name: "acompanhar_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Acompanhe seu atendimento.",
      buttons: [{ type: "URL", text: "Acompanhar", url: "https://example.com/{{1}}" }],
    })).rejects.toThrow("Informe um exemplo para o parâmetro do link dinâmico");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects mixed quick replies and call-to-action buttons", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createWhatsAppTemplate({
      name: "opcoes_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Escolha uma opção.",
      buttons: [
        { type: "QUICK_REPLY", text: "Confirmar" },
        { type: "URL", text: "Abrir portal", url: "https://example.com" },
      ],
    })).rejects.toThrow("sem combinar os dois formatos");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing or non-sequential variable examples before calling Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createWhatsAppTemplate({
      name: "lembrete_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Olá, {{2}}.",
      examples: ["Maria"],
    })).rejects.toThrow("As variáveis devem ser sequenciais");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Graph API permission errors without exposing the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Missing permission", type: "OAuthException", code: 200 } }),
    }));

    await expect(listWhatsAppTemplates()).rejects.toThrow(
      "A Meta recusou a operação com modelos (OAuthException, code 200): Missing permission",
    );
  });

  it("surfaces detailed Meta template validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Invalid parameter",
          type: "OAuthException",
          code: 100,
          error_subcode: 2388023,
          error_user_msg: "O exemplo da variável {{2}} é obrigatório.",
          fbtrace_id: "trace-123",
        },
      }),
    }));

    await expect(createWhatsAppTemplate({
      name: "lembrete_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      body: "Seu atendimento está confirmado.",
    })).rejects.toThrow(
      "A Meta recusou a operação com modelos (OAuthException, code 100, subcode 2388023, trace trace-123): O exemplo da variável {{2}} é obrigatório.",
    );
  });

  it("describes body, header, and dynamic URL parameters required for sending", () => {
    const template = {
      id: "123",
      name: "confirmar_agendamento",
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "TEXT", text: "Atendimento de {{1}}" },
        { type: "BODY", text: "Olá, {{1}}. Sua consulta será em {{2}}." },
        { type: "BUTTONS", buttons: [{ type: "URL" as const, text: "Ver consulta", url: "https://example.com/{{1}}" }] },
      ],
    };

    expect(getWhatsAppTemplateSendRequirements(template)).toEqual({
      headerCount: 1,
      bodyCount: 2,
      buttonUrls: [{ index: 0, label: "Ver consulta" }],
      unsupportedReason: null,
    });
    expect(validateWhatsAppTemplateSendParameters(template, {
      header: ["Maria"],
      body: ["Maria", "10/09/2026"],
      buttonUrls: [{ index: 0, value: "consulta-123" }],
    })).toEqual({
      header: ["Maria"],
      body: ["Maria", "10/09/2026"],
      buttonUrls: [{ index: 0, value: "consulta-123" }],
    });
  });

  it("blocks media-header templates from the text-only chat composer", () => {
    const requirements = getWhatsAppTemplateSendRequirements({
      id: "media-1",
      name: "comprovante",
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Seu comprovante." }],
    });

    expect(requirements.unsupportedReason).toContain("cabeçalho de mídia");
  });
});