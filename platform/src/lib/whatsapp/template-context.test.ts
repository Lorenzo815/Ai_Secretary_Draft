import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "../companies/ownership";
import type { WhatsAppTemplate } from "./templates";
import type { WhatsAppTemplatePayload } from "./template-context";

const { catalog } = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock("./templates", () => ({ getCachedWhatsAppTemplates: catalog }));
import { hydrateWhatsAppTemplateContext, renderSentWhatsAppTemplateContext, renderWhatsAppTemplateContext } from "./template-context";

const definition: WhatsAppTemplate = {
  id: "123", name: "appointment_confirmation", language: "pt_BR", category: "UTILITY", status: "APPROVED",
  components: [
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmar" }, { type: "QUICK_REPLY", text: "Reagendar" }] },
    { type: "BODY", text: "Sua consulta será em {{1}} às {{2}}.", example: { body_text: [["EXAMPLE-DATE", "EXAMPLE-TIME"]] } },
    { type: "FOOTER", text: "Selecione uma opção." },
    { type: "HEADER", format: "TEXT", text: "Olá, {{1}}!" },
  ],
};
const payload: WhatsAppTemplatePayload = {
  name: definition.name, language: { code: "pt_BR" },
  components: [
    { type: "header", parameters: [{ type: "text", text: "Maria" }] },
    { type: "body", parameters: [{ type: "text", text: "26/10" }, { type: "text", text: "10h" }] },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  catalog.mockResolvedValue([definition]);
});

describe("verified template context rendering", () => {
  it("renders actual header/body parameters, footer and buttons in message order", async () => {
    const result = await hydrateWhatsAppTemplateContext(legacyCompanyId(), "waba-1", payload);
    expect(catalog).toHaveBeenCalledWith(legacyCompanyId(), "waba-1");
    expect(result).toEqual({
      body: "Olá, Maria!\n\nSua consulta será em 26/10 às 10h.\n\nSelecione uma opção.\n\nOpções: Confirmar | Reagendar",
      templateName: definition.name, templateLanguage: "pt_BR",
    });
    expect(result.body).not.toContain("EXAMPLE");
  });

  it("also resolves an explicit template ID without guessing from a message ID", async () => {
    expect(await hydrateWhatsAppTemplateContext(legacyCompanyId(), "waba-1", { ...payload, id: "123", name: undefined }))
      .toMatchObject({ templateName: definition.name });
    await expect(hydrateWhatsAppTemplateContext(legacyCompanyId(), "waba-1", { ...payload, id: "wamid.original" }))
      .rejects.toThrow("WHATSAPP_TEMPLATE_REFERENCE_UNRESOLVED");
  });

  it("reuses the renderer for sends made by Oria", () => {
    expect(renderSentWhatsAppTemplateContext(definition, {
      header: ["Maria"], body: ["26/10", "10h"], buttonUrls: [],
    })).toEqual(renderWhatsAppTemplateContext(definition, payload));
  });

  it("renders named parameters in the correct positions and preserves literal substitution characters", () => {
    const template: WhatsAppTemplate = {
      ...definition, components: [{ type: "BODY", text: "Olá, {{name}}. Valor: {{amount}}. Olá novamente, {{name}}." }],
    };
    expect(renderWhatsAppTemplateContext(template, {
      components: [{ type: "body", parameters: [
        { type: "currency", parameter_name: "amount", currency: { fallback_value: "R$ 100" } },
        { type: "text", parameter_name: "name", text: "$& {{literal}}" },
      ] }],
    }).body).toBe("Olá, $& {{literal}}. Valor: R$ 100. Olá novamente, $& {{literal}}.");
  });

  it("uses a supplied date-time fallback, never catalog sample values", () => {
    expect(renderWhatsAppTemplateContext({
      ...definition, components: [{ type: "BODY", text: "Data: {{1}}", example: { body_text: [["WRONG"]] } }],
    }, { components: [{ type: "body", parameters: [{ type: "date_time", date_time: { fallback_value: "26/10 às 10h" } }] }] }).body)
      .toBe("Data: 26/10 às 10h");
  });

  it.each([
    undefined,
    {},
    { name: "appointment_confirmation" },
  ])("rejects missing template references", async reference => {
    await expect(hydrateWhatsAppTemplateContext(legacyCompanyId(), "waba-1", reference))
      .rejects.toThrow("WHATSAPP_TEMPLATE_REFERENCE_MISSING");
    expect(catalog).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, language: { code: "en_US" } },
    { ...payload, name: "other_template" },
    { ...payload, id: "wrong" },
  ])("does not guess the template or its language", async reference => {
    await expect(hydrateWhatsAppTemplateContext(legacyCompanyId(), "waba-1", reference))
      .rejects.toThrow("WHATSAPP_TEMPLATE_REFERENCE_UNRESOLVED");
  });

  it("rejects ambiguous catalog matches and propagates company/WABA authorization failures", async () => {
    catalog.mockResolvedValueOnce([definition, definition]);
    await expect(hydrateWhatsAppTemplateContext(legacyCompanyId(), "waba-1", payload))
      .rejects.toThrow("WHATSAPP_TEMPLATE_REFERENCE_UNRESOLVED");
    catalog.mockRejectedValueOnce(new Error("WHATSAPP_TEMPLATE_WABA_MISMATCH"));
    await expect(hydrateWhatsAppTemplateContext(new ObjectId(), "wrong-waba", payload))
      .rejects.toThrow("WHATSAPP_TEMPLATE_WABA_MISMATCH");
  });

  it.each([
    { parameters: [] },
    { parameters: [{ type: "text", text: "26/10" }] },
    { parameters: [{ type: "text", text: "26/10" }, { type: "text", text: "10h" }, { type: "text", text: "extra" }] },
    { parameters: [{ type: "payload", payload: "not-a-text-value" }, { type: "text", text: "10h" }] },
  ])("rejects missing, extra or unsupported body values instead of filling examples", ({ parameters }) => {
    expect(() => renderWhatsAppTemplateContext(definition, {
      ...payload, components: [{ type: "header", parameters: [{ type: "text", text: "Maria" }] }, { type: "body", parameters }],
    })).toThrow("WHATSAPP_TEMPLATE_PARAMETER");
  });

  it("does not collapse media headers into invented text", () => {
    expect(renderWhatsAppTemplateContext({
      ...definition, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Mensagem estática." }],
    }, {}).body).toBe("[Cabeçalho: image]\n\nMensagem estática.");
  });

  it("rejects unsupported components rather than silently omitting customer-visible content", () => {
    expect(() => renderWhatsAppTemplateContext({
      ...definition, components: [{ type: "CAROUSEL" }],
    }, {})).toThrow("WHATSAPP_TEMPLATE_COMPONENT_UNSUPPORTED");
  });
});
