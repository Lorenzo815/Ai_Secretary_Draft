"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  Link2,
  LoaderCircle,
  MessageCircleReply,
  Phone,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

interface TemplateSummary {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<{ type: string; text?: string }>;
}

type ButtonMode = "NONE" | "QUICK_REPLY" | "CALL_TO_ACTION";

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  IN_APPEAL: "bg-amber-50 text-amber-700",
  PAUSED: "bg-amber-50 text-amber-700",
  REJECTED: "bg-rose-50 text-rose-700",
  DISABLED: "bg-stone-100 text-stone",
};

const STATUS_LABELS: Record<string, string> = {
  APPROVED: "Aprovado",
  DELETED: "Excluído",
  DISABLED: "Desativado",
  IN_APPEAL: "Em recurso",
  LIMIT_EXCEEDED: "Limite excedido",
  PAUSED: "Pausado",
  PENDING: "Em análise",
  PENDING_DELETION: "Exclusão pendente",
  REJECTED: "Rejeitado",
};

export default function TemplatesManager({
  initialTemplates,
  loadError,
}: {
  initialTemplates: TemplateSummary[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("lembrete_agendamento");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("Olá, {{1}}. Este é um lembrete do seu atendimento agendado para {{2}} às {{3}}. Se precisar alterar, responda a esta mensagem.");
  const [examples, setExamples] = useState(["Maria", "10/09/2026", "14:30"]);
  const [buttonMode, setButtonMode] = useState<ButtonMode>("NONE");
  const [quickReplies, setQuickReplies] = useState(["Confirmar"]);
  const [phoneEnabled, setPhoneEnabled] = useState(false);
  const [phoneText, setPhoneText] = useState("Ligar");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [urlEnabled, setUrlEnabled] = useState(false);
  const [urlText, setUrlText] = useState("Abrir site");
  const [url, setUrl] = useState("");
  const [urlExample, setUrlExample] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const variableCount = useMemo(() => {
    const indexes = Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1]));
    return indexes.length === 0 ? 0 : Math.max(...indexes);
  }, [body]);
  const filteredTemplates = initialTemplates.filter((template) => (
    `${template.name} ${template.language} ${template.category} ${template.status}`
      .toLocaleLowerCase("pt-BR")
      .includes(query.trim().toLocaleLowerCase("pt-BR"))
  ));
  const approvedCount = initialTemplates.filter((template) => template.status === "APPROVED").length;
  const pendingCount = initialTemplates.filter((template) => template.status === "PENDING").length;
  const buttons = useMemo(() => {
    if (buttonMode === "QUICK_REPLY") {
      return quickReplies.map((text) => ({ type: "QUICK_REPLY" as const, text }));
    }
    if (buttonMode === "CALL_TO_ACTION") {
      return [
        ...(phoneEnabled ? [{ type: "PHONE_NUMBER" as const, text: phoneText, phoneNumber }] : []),
        ...(urlEnabled ? [{ type: "URL" as const, text: urlText, url, example: urlExample }] : []),
      ];
    }
    return [];
  }, [buttonMode, phoneEnabled, phoneNumber, phoneText, quickReplies, url, urlEnabled, urlExample, urlText]);

  useEffect(() => {
    setExamples((current) => Array.from(
      { length: variableCount },
      (_, index) => current[index] ?? "",
    ));
  }, [variableCount]);

  useEffect(() => {
    if (!dialogOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) setDialogOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dialogOpen, submitting]);

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, language, category, body, examples, buttons }),
      });
      const result = await response.json() as { template?: { id: string }; error?: string };
      if (!response.ok || !result.template) {
        throw new Error(result.error ?? "Não foi possível criar o modelo.");
      }
      setDialogOpen(false);
      setMessage("Modelo enviado para análise da Meta.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível criar o modelo.");
    } finally {
      setSubmitting(false);
    }
  }

  function updateExample(index: number, value: string) {
    setExamples((current) => current.map((example, itemIndex) => (
      itemIndex === index ? value : example
    )));
  }

  function updateQuickReply(index: number, value: string) {
    setQuickReplies((current) => current.map((text, itemIndex) => (
      itemIndex === index ? value : text
    )));
  }

  return <>
    {loadError && <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{loadError}</p></div>}
    {message && <div className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${message.includes("enviado") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{message.includes("enviado") ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}<p>{message}</p></div>}

    <section aria-label="Resumo dos modelos" className="grid overflow-hidden rounded-lg border border-mist bg-white sm:grid-cols-3 sm:divide-x sm:divide-mist">
      <Summary icon={FileText} label="Total" value={initialTemplates.length} />
      <Summary icon={CheckCircle2} label="Aprovados" value={approvedCount} tone="text-emerald-700 bg-emerald-50" />
      <Summary icon={Clock3} label="Em análise" value={pendingCount} tone="text-amber-700 bg-amber-50" />
    </section>

    <section className="overflow-hidden rounded-lg border border-mist bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-mist px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">Buscar modelos</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, status ou idioma" className="min-h-10 w-full rounded-md border border-mist bg-white pl-9 pr-3 text-sm text-slate-ink outline-none focus:border-deep-teal" />
        </label>
        <button type="button" onClick={() => { setMessage(null); setDialogOpen(true); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white transition-colors hover:bg-deep-teal/90"><Plus className="h-4 w-4" />Criar modelo</button>
      </div>

      {filteredTemplates.length > 0 ? <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-pearl/70 text-[11px] font-bold uppercase text-stone"><tr><th className="px-5 py-3">Modelo</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Idioma</th><th className="px-4 py-3">Status</th><th className="px-5 py-3">Conteúdo</th></tr></thead>
          <tbody className="divide-y divide-mist">
            {filteredTemplates.map((template) => {
              const bodyText = template.components.find((component) => component.type === "BODY")?.text;
              return <tr key={template.id} className="align-top hover:bg-pearl/40"><td className="px-5 py-4 font-semibold text-slate-ink">{template.name}</td><td className="px-4 py-4 text-stone">{template.category === "UTILITY" ? "Utilidade" : template.category === "MARKETING" ? "Marketing" : template.category}</td><td className="px-4 py-4 text-stone">{template.language}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[template.status] ?? "bg-stone-100 text-stone"}`}>{STATUS_LABELS[template.status] ?? template.status}</span></td><td className="max-w-md px-5 py-4 leading-5 text-stone"><span className="line-clamp-2">{bodyText ?? "Sem conteúdo textual"}</span></td></tr>;
            })}
          </tbody>
        </table>
      </div> : <div className="px-5 py-14 text-center"><FileText className="mx-auto h-8 w-8 text-mist" /><p className="mt-3 text-sm font-semibold text-slate-ink">{query ? "Nenhum modelo encontrado" : "Nenhum modelo cadastrado"}</p><p className="mt-1 text-sm text-stone">{query ? "Tente outro termo de busca." : "Crie o primeiro modelo para iniciar a análise da Meta."}</p></div>}
    </section>

    {dialogOpen && createPortal(<div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-ink/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setDialogOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-template-title" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-lg bg-white shadow-2xl sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-mist bg-white px-5 py-4 sm:px-6">
          <div><h2 id="create-template-title" className="font-heading text-lg font-semibold text-slate-ink">Criar modelo</h2><p className="mt-1 text-sm text-stone">O modelo será enviado à Meta para análise.</p></div>
          <button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} aria-label="Fechar" title="Fechar" className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-pearl hover:text-slate-ink disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={createTemplate} className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 px-5 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-ink">Nome<input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} required maxLength={512} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" /></label>
              <label className="text-xs font-semibold text-slate-ink">Idioma<select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal"><option value="pt_BR">Português (Brasil)</option><option value="en_US">English (US)</option><option value="es">Español</option></select></label>
            </div>
            <fieldset><legend className="text-xs font-semibold text-slate-ink">Categoria</legend><div className="mt-1.5 grid grid-cols-2 overflow-hidden rounded-md border border-mist">{(["UTILITY", "MARKETING"] as const).map((value) => <label key={value} className={`cursor-pointer px-3 py-2.5 text-center text-sm font-semibold transition-colors ${category === value ? "bg-deep-teal text-white" : "bg-white text-stone hover:bg-pearl"}`}><input type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)} className="sr-only" />{value === "UTILITY" ? "Utilidade" : "Marketing"}</label>)}</div></fieldset>
            <label className="block text-xs font-semibold text-slate-ink">Conteúdo<textarea value={body} onChange={(event) => setBody(event.target.value)} required maxLength={1024} rows={6} className="mt-1.5 w-full resize-y rounded-md border border-mist px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-deep-teal" /><span className="mt-1 block text-right text-[11px] font-normal text-stone">{body.length}/1.024</span></label>
            {variableCount > 0 && <fieldset><legend className="text-xs font-semibold text-slate-ink">Exemplos das variáveis</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{examples.map((example, index) => <label key={index} className="text-xs font-medium text-stone"><span className="font-mono text-slate-ink">{`{{${index + 1}}}`}</span><input value={example} onChange={(event) => updateExample(index, event.target.value)} required placeholder={`Exemplo para {{${index + 1}}}`} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal text-slate-ink outline-none focus:border-deep-teal" /></label>)}</div></fieldset>}
            <fieldset>
              <legend className="text-xs font-semibold text-slate-ink">Botões</legend>
              <div className="mt-1.5 grid grid-cols-3 overflow-hidden rounded-md border border-mist">
                {(["NONE", "QUICK_REPLY", "CALL_TO_ACTION"] as const).map((value) => <label key={value} className={`cursor-pointer px-2 py-2.5 text-center text-xs font-semibold transition-colors sm:text-sm ${buttonMode === value ? "bg-deep-teal text-white" : "bg-white text-stone hover:bg-pearl"}`}><input type="radio" name="buttonMode" value={value} checked={buttonMode === value} onChange={() => setButtonMode(value)} className="sr-only" />{value === "NONE" ? "Nenhum" : value === "QUICK_REPLY" ? "Respostas" : "Ações"}</label>)}
              </div>
            </fieldset>
            {buttonMode === "QUICK_REPLY" && <div className="space-y-3">
              {quickReplies.map((reply, index) => <label key={index} className="block text-xs font-semibold text-slate-ink">Resposta rápida {index + 1}<span className="mt-1.5 flex gap-2"><span className="relative flex-1"><MessageCircleReply className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" /><input value={reply} onChange={(event) => updateQuickReply(index, event.target.value)} required maxLength={25} className="min-h-10 w-full rounded-md border border-mist pl-9 pr-3 text-sm font-normal outline-none focus:border-deep-teal" /></span>{quickReplies.length > 1 && <button type="button" onClick={() => setQuickReplies((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover resposta rápida ${index + 1}`} title="Remover" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-mist text-stone hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}</span></label>)}
              {quickReplies.length < 3 && <button type="button" onClick={() => setQuickReplies((current) => [...current, ""])} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-mist px-3 text-xs font-semibold text-slate-ink hover:bg-pearl"><Plus className="h-3.5 w-3.5" />Adicionar resposta</button>}
            </div>}
            {buttonMode === "CALL_TO_ACTION" && <div className="space-y-3">
              <section className="rounded-md border border-mist p-3">
                <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={phoneEnabled} onChange={(event) => setPhoneEnabled(event.target.checked)} className="h-4 w-4 accent-deep-teal" /><Phone className="h-4 w-4 text-deep-teal" /><span className="text-sm font-semibold text-slate-ink">Telefone</span></label>
                {phoneEnabled && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-ink">Texto<input value={phoneText} onChange={(event) => setPhoneText(event.target.value)} required maxLength={25} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" /></label><label className="text-xs font-semibold text-slate-ink">Número<input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} required placeholder="+55 11 99999-9999" className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" /></label></div>}
              </section>
              <section className="rounded-md border border-mist p-3">
                <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={urlEnabled} onChange={(event) => setUrlEnabled(event.target.checked)} className="h-4 w-4 accent-deep-teal" /><Link2 className="h-4 w-4 text-deep-teal" /><span className="text-sm font-semibold text-slate-ink">Link</span></label>
                {urlEnabled && <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]"><label className="text-xs font-semibold text-slate-ink">Texto<input value={urlText} onChange={(event) => setUrlText(event.target.value)} required maxLength={25} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" /></label><label className="text-xs font-semibold text-slate-ink">URL<input type="text" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="https://exemplo.com/agenda/{{1}}" className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" /></label>{url.includes("{{1}}") && <label className="text-xs font-semibold text-slate-ink sm:col-start-2">Exemplo do parâmetro<input value={urlExample} onChange={(event) => setUrlExample(event.target.value)} required placeholder="consulta-123" className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" /></label>}</div>}
              </section>
            </div>}
          </div>
          <aside className="border-t border-mist bg-pearl/60 px-5 py-5 lg:border-l lg:border-t-0">
            <p className="text-[11px] font-bold uppercase text-deep-teal">Prévia</p>
            <div className="mt-4 rounded-md bg-[#efeae2] p-4 shadow-inner"><div className="ml-auto max-w-[270px] overflow-hidden rounded-md rounded-tr-none bg-[#d9fdd3] text-sm text-[#111b21] shadow-sm"><div className="px-3 py-2 leading-5">{renderPreview(body, examples) || "O conteúdo aparecerá aqui."}<div className="mt-1 text-right text-[10px] text-[#667781]">14:30</div></div>{buttons.length > 0 && <div className="divide-y divide-[#c7e8c3] border-t border-[#c7e8c3] bg-white/55">{buttons.map((button, index) => <div key={`${button.type}-${index}`} className="flex min-h-9 items-center justify-center gap-2 px-2 text-center text-xs font-semibold text-[#027eb5]">{button.type === "PHONE_NUMBER" ? <Phone className="h-3.5 w-3.5" /> : button.type === "URL" ? <Link2 className="h-3.5 w-3.5" /> : <MessageCircleReply className="h-3.5 w-3.5" />}{button.text || "Texto do botão"}</div>)}</div>}</div></div>
          </aside>
          <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-mist bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6 lg:col-span-2"><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="min-h-10 rounded-md border border-mist px-4 text-sm font-semibold text-slate-ink hover:bg-pearl disabled:opacity-50">Cancelar</button><button type="submit" disabled={submitting} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-deep-teal/90 disabled:cursor-wait disabled:opacity-60">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{submitting ? "Enviando..." : "Criar e enviar"}</button></div>
        </form>
      </section>
    </div>, document.body)}
  </>;
}

function Summary({ icon: Icon, label, value, tone = "text-deep-teal bg-deep-teal/10" }: { icon: typeof FileText; label: string; value: number; tone?: string }) {
  return <div className="flex items-center gap-3 border-b border-mist px-4 py-4 last:border-b-0 sm:border-b-0 sm:px-5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone}`}><Icon className="h-4 w-4" /></span><div><p className="text-xs font-semibold text-stone">{label}</p><p className="mt-0.5 text-lg font-bold text-slate-ink">{value}</p></div></div>;
}

function renderPreview(body: string, examples: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => examples[Number(index) - 1] || `{{${index}}}`);
}