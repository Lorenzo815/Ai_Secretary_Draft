"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CircleAlert, FileText, LoaderCircle, SendHorizontal } from "lucide-react";

interface TemplateButton {
  type: string;
  text: string;
  url?: string;
  phone_number?: string;
}

interface TemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: TemplateButton[];
}

interface ApprovedTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: TemplateComponent[];
}

interface ConversationMessage {
  messageId: string;
  direction: "outbound";
  type: "template";
  templateName: string;
  body: string;
  status: "sent";
  sentBy: string;
  timestamp: string;
}

interface Requirements {
  bodyCount: number;
  headerCount: number;
  buttonUrls: Array<{ index: number; label: string }>;
  unsupportedReason: string | null;
}

export default function WhatsAppTemplateComposer({
  customerId,
  recipientAvailable,
  onSent,
}: {
  customerId: string;
  recipientAvailable: boolean;
  onSent: (message: ConversationMessage) => void;
}) {
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [headerParameters, setHeaderParameters] = useState<string[]>([]);
  const [bodyParameters, setBodyParameters] = useState<string[]>([]);
  const [buttonParameters, setButtonParameters] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const approvedTemplates = useMemo(() => templates.filter((template) => template.status === "APPROVED"), [templates]);
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedId) ?? null;
  const requirements = useMemo(
    () => selectedTemplate ? getRequirements(selectedTemplate) : null,
    [selectedTemplate],
  );
  const preview = selectedTemplate ? getTemplatePreview(selectedTemplate, headerParameters, bodyParameters) : null;
  const dirty = headerParameters.some(Boolean) || bodyParameters.some(Boolean) || Object.values(buttonParameters).some(Boolean);
  const parametersComplete = requirements !== null && (
    !requirements.unsupportedReason
    && headerParameters.length === requirements.headerCount
    && headerParameters.every((value) => value.trim())
    && bodyParameters.length === requirements.bodyCount
    && bodyParameters.every((value) => value.trim())
    && requirements.buttonUrls.every((button) => buttonParameters[button.index]?.trim())
  );

  useEffect(() => {
    const controller = new AbortController();
    async function loadTemplates() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/whatsapp/templates", { signal: controller.signal });
        const result = await response.json() as { templates?: ApprovedTemplate[]; error?: string };
        if (!response.ok || !result.templates) throw new Error(result.error ?? "Não foi possível carregar os modelos.");
        const approved = result.templates.filter((template) => template.status === "APPROVED");
        setTemplates(result.templates);
        setSelectedId((current) => current || approved[0]?.id || "");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os modelos.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadTemplates();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!requirements) {
      setHeaderParameters([]);
      setBodyParameters([]);
      setButtonParameters({});
      return;
    }
    setHeaderParameters(Array.from({ length: requirements.headerCount }, () => ""));
    setBodyParameters(Array.from({ length: requirements.bodyCount }, () => ""));
    setButtonParameters(Object.fromEntries(requirements.buttonUrls.map((button) => [button.index, ""])));
  }, [requirements]);

  async function sendTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !requirements || !parametersComplete || !recipientAvailable) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/customers/${customerId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "template",
          templateId: selectedTemplate.id,
          parameters: {
            header: headerParameters,
            body: bodyParameters,
            buttonUrls: requirements.buttonUrls.map((button) => ({
              index: button.index,
              value: buttonParameters[button.index] ?? "",
            })),
          },
        }),
      });
      const result = await response.json() as { message?: ConversationMessage; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Não foi possível enviar o modelo.");
      onSent(result.message);
      setHeaderParameters((current) => current.map(() => ""));
      setBodyParameters((current) => current.map(() => ""));
      setButtonParameters((current) => Object.fromEntries(Object.keys(current).map((key) => [key, ""])));
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Não foi possível enviar o modelo.");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-stone"><LoaderCircle className="size-4 animate-spin" />Carregando modelos aprovados...</div>;

  return <form onSubmit={sendTemplate} data-auto-refresh-dirty={dirty ? "true" : undefined} className="space-y-4">
    {error && <p role="alert" className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2.5 text-xs font-semibold text-burnt-coral"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
    {!recipientAvailable ? <p className="rounded-md bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">Cadastre um telefone para enviar modelos a este cliente.</p> : approvedTemplates.length === 0 ? <div className="py-6 text-center"><FileText className="mx-auto size-7 text-mist" /><p className="mt-2 text-sm font-semibold text-slate-ink">Nenhum modelo aprovado</p><p className="mt-1 text-xs text-stone">Crie um modelo e aguarde a aprovação da Meta.</p></div> : <>
      <label className="block text-xs font-semibold text-slate-ink">Modelo aprovado<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal">{approvedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {formatLanguage(template.language)}</option>)}</select></label>

      {requirements?.unsupportedReason ? <p className="rounded-md bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">{requirements.unsupportedReason}</p> : <>
        {(requirements?.headerCount ?? 0) > 0 && <ParameterFields label="Cabeçalho" values={headerParameters} onChange={setHeaderParameters} />}
        {(requirements?.bodyCount ?? 0) > 0 && <ParameterFields label="Conteúdo" values={bodyParameters} onChange={setBodyParameters} />}
        {(requirements?.buttonUrls.length ?? 0) > 0 && <fieldset><legend className="text-xs font-semibold text-slate-ink">Links dos botões</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{requirements!.buttonUrls.map((button) => <label key={button.index} className="text-xs font-medium text-stone">{button.label}<input value={buttonParameters[button.index] ?? ""} onChange={(event) => setButtonParameters((current) => ({ ...current, [button.index]: event.target.value }))} required placeholder="Valor dinâmico do link" className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal text-slate-ink outline-none focus:border-deep-teal" /></label>)}</div></fieldset>}

        {preview && <div><p className="text-xs font-semibold text-slate-ink">Prévia</p><div className="mt-2 rounded-md bg-[#efeae2] p-3"><div className="ml-auto max-w-sm rounded-md rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm leading-5 text-[#111b21] shadow-sm">{preview.header && <p className="mb-1 font-semibold">{preview.header}</p>}<p className="whitespace-pre-wrap">{preview.body}</p>{preview.footer && <p className="mt-1 text-xs text-[#667781]">{preview.footer}</p>}{preview.buttons.length > 0 && <div className="mt-2 divide-y divide-[#c4dfc0] border-t border-[#c4dfc0] text-center text-xs font-semibold text-[#027eb5]">{preview.buttons.map((button, index) => <p key={`${button}-${index}`} className="py-1.5">{button}</p>)}</div>}</div></div></div>}
      </>}
    </>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-3"><p className="max-w-lg text-xs leading-5 text-stone">Modelos aprovados podem ser enviados a qualquer momento, inclusive fora da janela de 24 horas.</p><button type="submit" disabled={!recipientAvailable || !selectedTemplate || !parametersComplete || sending} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white transition hover:bg-forest-teal disabled:cursor-not-allowed disabled:opacity-50"><SendHorizontal className="size-4" />{sending ? "Enviando..." : "Enviar modelo"}</button></div>
  </form>;
}

function ParameterFields({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset><legend className="text-xs font-semibold text-slate-ink">Variáveis do {label.toLocaleLowerCase("pt-BR")}</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{values.map((value, index) => <label key={index} className="text-xs font-medium text-stone"><span className="font-mono text-slate-ink">{`{{${index + 1}}}`}</span><input value={value} onChange={(event) => onChange(values.map((current, valueIndex) => valueIndex === index ? event.target.value : current))} required placeholder={`Valor de {{${index + 1}}}`} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal text-slate-ink outline-none focus:border-deep-teal" /></label>)}</div></fieldset>;
}

function getRequirements(template: ApprovedTemplate): Requirements {
  const header = template.components.find((component) => component.type === "HEADER");
  const body = template.components.find((component) => component.type === "BODY");
  const buttons = template.components.find((component) => component.type === "BUTTONS")?.buttons ?? [];
  const unknownComponent = template.components.find((component) => !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(component.type));
  return {
    bodyCount: countVariables(body?.text ?? ""),
    headerCount: countVariables(header?.text ?? ""),
    buttonUrls: buttons.flatMap((button, index) => button.type === "URL" && button.url?.includes("{{1}}") ? [{ index, label: button.text }] : []),
    unsupportedReason: unknownComponent
      ? `O componente ${unknownComponent.type} ainda não é suportado nesta tela.`
      : header?.format && header.format !== "TEXT"
        ? "Modelos com cabeçalho de mídia ainda não podem ser enviados por esta tela."
        : null,
  };
}

function countVariables(text: string) {
  return new Set(Array.from(text.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1]))).size;
}

function getTemplatePreview(template: ApprovedTemplate, headerParameters: string[], bodyParameters: string[]) {
  const replace = (text: string | undefined, parameters: string[]) => (text ?? "").replace(/\{\{(\d+)\}\}/g, (_, index: string) => parameters[Number(index) - 1] || `{{${index}}}`);
  const header = template.components.find((component) => component.type === "HEADER");
  const body = template.components.find((component) => component.type === "BODY");
  const footer = template.components.find((component) => component.type === "FOOTER");
  const buttons = template.components.find((component) => component.type === "BUTTONS")?.buttons ?? [];
  return { header: replace(header?.text, headerParameters), body: replace(body?.text, bodyParameters), footer: footer?.text ?? "", buttons: buttons.map((button) => button.text) };
}

function formatLanguage(language: string) {
  if (language === "pt_BR") return "Português (Brasil)";
  if (language === "en_US") return "English (US)";
  return language;
}