"use client";

import { useEffect, useState, type ReactNode } from "react";

type Lifecycle = "single_call" | "tool_cycle";
type Tab = "overview" | "lifecycle" | "prompts" | "output" | "transitions" | "versions";

interface FlowVersionView {
  version: number;
  prompt: string;
  lifecycle: Lifecycle;
  preToolPrompt: string;
  postToolPrompt: string;
  allowedTools: string[];
  knowledgeContext: string;
  completionCriteria: string;
  allowedTransitions: string[];
  createdAt: string;
}

interface FlowView {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  currentVersion: number;
  versions: FlowVersionView[];
  promptPreviews: Record<string, string>;
  outputSchemas: Record<string, unknown>;
}

interface GlobalSettings {
  defaultFlowKey: string;
  globalPrompt: string;
  offensePolicy: string;
  handoffPolicy: string;
  version: number;
  updatedAt: string;
}

interface Payload {
  flows: FlowView[];
  settings: GlobalSettings;
  availableTools: ToolMetadata[];
  structuralPolicy: string;
}

interface ToolMetadata {
  key: string;
  label: string;
  description: string;
  mutates: boolean;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Visão geral" },
  { id: "lifecycle", label: "Lifecycle e tools" },
  { id: "prompts", label: "Prompts" },
  { id: "output", label: "Output estruturado" },
  { id: "transitions", label: "Transições" },
  { id: "versions", label: "Versões" },
];

const inputClass = "mt-2 w-full rounded-lg border border-mist bg-white px-3 py-2.5 font-normal outline-none focus:border-deep-teal";
const textareaClass = "mt-2 w-full resize-y rounded-lg border border-mist bg-white px-3 py-3 text-sm font-normal leading-6 outline-none focus:border-deep-teal";

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowView[]>([]);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [structuralPolicy, setStructuralPolicy] = useState("");
  const [availableTools, setAvailableTools] = useState<ToolMetadata[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState<FlowView | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [globalOpen, setGlobalOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  function applyPayload(data: Payload, preferredKey?: string) {
    const selected = data.flows.find((flow) => flow.key === preferredKey)
      ?? data.flows.find((flow) => flow.key === data.settings.defaultFlowKey)
      ?? data.flows[0];
    setFlows(data.flows);
    setSettings(data.settings);
    setSettingsDraft(structuredClone(data.settings));
    setStructuralPolicy(data.structuralPolicy);
    setAvailableTools(data.availableTools);
    if (selected) {
      setSelectedKey(selected.key);
      setDraft(structuredClone(selected));
    }
  }

  async function fetchPayload() {
    const response = await fetch("/api/assistant/flows", { cache: "no-store" });
    const data = await response.json() as Partial<Payload> & { error?: string };
    if (!response.ok || !data.flows || !data.settings || !data.availableTools || typeof data.structuralPolicy !== "string") {
      throw new Error(data.error ?? "Não foi possível carregar os fluxos.");
    }
    return data as Payload;
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/assistant/flows", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as Partial<Payload> & { error?: string };
        if (!active) return;
        if (!response.ok || !data.flows || !data.settings || !data.availableTools || typeof data.structuralPolicy !== "string") {
          throw new Error(data.error ?? "Não foi possível carregar os fluxos.");
        }
        applyPayload(data as Payload);
      })
      .catch((error) => { if (active) setFeedback(error instanceof Error ? error.message : "Falha ao carregar fluxos."); });
    return () => { active = false; };
  }, []);

  function selectFlow(key: string) {
    const flow = flows.find((item) => item.key === key);
    if (!flow) return;
    setSelectedKey(key);
    setDraft(structuredClone(flow));
    setTab("overview");
    setFeedback("");
  }

  function currentVersion(flow: FlowView) {
    return flow.versions.find((version) => version.version === flow.currentVersion)!;
  }

  function updateVersion(patch: Partial<FlowVersionView>) {
    if (!draft) return;
    setDraft({ ...draft, versions: draft.versions.map((version) => version.version === draft.currentVersion ? { ...version, ...patch } : version) });
  }

  async function saveFlow() {
    if (!draft || !hasChanges) return;
    setSaving(true);
    setFeedback("");
    const version = currentVersion(draft);
    const response = await fetch("/api/assistant/flows", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "flow", key: draft.key, name: draft.name, description: draft.description, ...version }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) setFeedback(result.error ?? "Não foi possível publicar o fluxo.");
    else {
      applyPayload(await fetchPayload(), draft.key);
      setFeedback("Nova versão publicada. Atendimentos em andamento mantêm a versão anterior.");
    }
    setSaving(false);
  }

  async function saveGlobals() {
    if (!settingsDraft || !globalHasChanges) return;
    setSaving(true);
    setFeedback("");
    const response = await fetch("/api/assistant/flows", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "global", ...settingsDraft }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) setFeedback(result.error ?? "Não foi possível salvar as políticas globais.");
    else {
      applyPayload(await fetchPayload(), selectedKey);
      setGlobalOpen(false);
      setFeedback("Políticas globais e fluxo default atualizados.");
    }
    setSaving(false);
  }

  const version = draft ? currentVersion(draft) : null;
  const persisted = flows.find((flow) => flow.key === draft?.key);
  const hasChanges = Boolean(draft && persisted && JSON.stringify(draft) !== JSON.stringify(persisted));
  const globalHasChanges = Boolean(settings && settingsDraft && JSON.stringify(settings) !== JSON.stringify(settingsDraft));
  const isDefault = draft?.key === settings?.defaultFlowKey;

  return (
    <div className="animate-fade-in-up space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-mist pb-5">
        <div>
          <p className="text-sm font-medium text-deep-teal">Automação</p>
          <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">Fluxos de atendimento</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone">Controle lifecycle, prompts, ferramentas, outputs e transições usados pela IA.</p>
        </div>
        <button type="button" onClick={() => setGlobalOpen(true)} className="rounded-lg border border-deep-teal/30 bg-white px-4 py-2.5 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5">Políticas globais</button>
      </header>

      {feedback && <p aria-live="polite" className={`text-sm ${feedback.includes("atualizad") || feedback.includes("publicada") ? "text-deep-teal" : "text-burnt-coral"}`}>{feedback}</p>}

      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Fluxos" className="space-y-2">
          <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase text-stone">Fluxos publicados</p><span className="text-xs text-stone">{flows.length}</span></div>
          {flows.map((flow) => {
            const itemVersion = currentVersion(flow);
            return <button key={flow.key} type="button" onClick={() => selectFlow(flow.key)} className={`w-full rounded-lg border p-4 text-left transition-colors ${selectedKey === flow.key ? "border-deep-teal bg-deep-teal/5" : "border-mist bg-white hover:border-deep-teal/35"}`}>
              <span className="flex flex-wrap items-center gap-1.5">
                {flow.key === settings?.defaultFlowKey && <Badge strong>Default</Badge>}
                <Badge>v{flow.currentVersion}</Badge>
                <Badge>{itemVersion.lifecycle === "tool_cycle" ? `${itemVersion.allowedTools.length} tools` : "Chamada única"}</Badge>
              </span>
              <span className="mt-2 block text-sm font-semibold text-slate-ink">{flow.name}</span>
              <span className="mt-1 block text-xs leading-5 text-stone">{flow.description}</span>
            </button>;
          })}
        </nav>

        {draft && version ? <section aria-labelledby="flow-name" className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist pb-4">
            <div><div className="flex items-center gap-2"><h2 id="flow-name" className="font-heading text-xl font-semibold text-slate-ink">{draft.name}</h2>{isDefault && <Badge strong>Fluxo default</Badge>}</div><p className="mt-1 font-mono text-xs text-stone">{draft.key} · versão {version.version}</p></div>
            {hasChanges && <span className="rounded-full bg-warm-sand px-3 py-1 text-xs font-semibold text-slate-ink/75">Alterações não publicadas</span>}
          </div>

          <div className="mt-4 overflow-x-auto border-b border-mist"><div role="tablist" className="flex min-w-max gap-5">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`border-b-2 px-1 pb-3 text-sm font-semibold ${tab === item.id ? "border-deep-teal text-deep-teal" : "border-transparent text-stone hover:text-slate-ink"}`}>{item.label}</button>)}</div></div>

          <div className="mt-6">
            {tab === "overview" && <Overview draft={draft} version={version} isDefault={isDefault} setDraft={setDraft} updateVersion={updateVersion} openGlobals={() => setGlobalOpen(true)} />}
            {tab === "lifecycle" && <LifecycleEditor version={version} tools={availableTools} updateVersion={updateVersion} />}
            {tab === "prompts" && <PromptEditor version={version} promptPreviews={draft.promptPreviews} structuralPolicy={structuralPolicy} updateVersion={updateVersion} />}
            {tab === "output" && <OutputSchemas schemas={draft.outputSchemas} lifecycle={version.lifecycle} />}
            {tab === "transitions" && <Transitions draft={draft} version={version} flows={flows} updateVersion={updateVersion} />}
            {tab === "versions" && <Versions draft={draft} flows={flows} />}
          </div>

          <div className="mt-7 flex justify-end border-t border-mist pt-5"><button type="button" onClick={saveFlow} disabled={saving || !hasChanges} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-45">{saving ? "Publicando..." : "Publicar nova versão"}</button></div>
        </section> : <p className="py-16 text-center text-sm text-stone">Carregando fluxos...</p>}
      </div>

      {globalOpen && settingsDraft && <GlobalModal settings={settingsDraft} flows={flows} structuralPolicy={structuralPolicy} saving={saving} hasChanges={globalHasChanges} setSettings={setSettingsDraft} close={() => setGlobalOpen(false)} save={saveGlobals} />}
    </div>
  );
}

function Overview({ draft, version, isDefault, setDraft, updateVersion, openGlobals }: { draft: FlowView; version: FlowVersionView; isDefault: boolean; setDraft: (flow: FlowView) => void; updateVersion: (patch: Partial<FlowVersionView>) => void; openGlobals: () => void }) {
  return <div className="space-y-5">
    {!isDefault && <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-deep-teal bg-deep-teal/5 px-4 py-3"><p className="text-sm text-slate-ink">Este fluxo não recebe automaticamente novos contatos.</p><button type="button" onClick={openGlobals} className="text-sm font-semibold text-deep-teal hover:underline">Alterar default</button></div>}
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Nome"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></Field><Field label="Chave imutável"><input value={draft.key} disabled className={`${inputClass} bg-soft-ivory font-mono text-xs text-stone`} /></Field></div>
    <Field label="Descrição operacional"><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClass} /></Field>
    <Field label="Conhecimento autorizado"><textarea value={version.knowledgeContext} onChange={(event) => updateVersion({ knowledgeContext: event.target.value })} rows={6} className={textareaClass} /></Field>
    <Field label="Critério de conclusão"><textarea value={version.completionCriteria} onChange={(event) => updateVersion({ completionCriteria: event.target.value })} rows={4} className={textareaClass} /></Field>
  </div>;
}

function LifecycleEditor({ version, tools, updateVersion }: { version: FlowVersionView; tools: ToolMetadata[]; updateVersion: (patch: Partial<FlowVersionView>) => void }) {
  return <div className="space-y-6">
    <fieldset><legend className="text-sm font-semibold text-slate-ink">Modo de execução</legend><div className="mt-3 grid gap-3 md:grid-cols-2"><Choice title="Chamada única" description="Uma inferência produz estado, transição e resposta, sem ferramentas." checked={version.lifecycle === "single_call"} click={() => updateVersion({ lifecycle: "single_call", allowedTools: [] })} /><Choice title="Ciclo com tools" description="Pré-tool decide, o servidor executa e a pós-tool responde com o resultado." checked={version.lifecycle === "tool_cycle"} click={() => updateVersion({ lifecycle: "tool_cycle" })} /></div></fieldset>
    <div className="overflow-x-auto rounded-lg border border-mist bg-white p-4"><div className="flex min-w-[650px] items-center justify-between gap-2 text-center text-xs font-semibold"><Stage label="Contexto" active /><Arrow /><Stage label={version.lifecycle === "tool_cycle" ? "Pré-tool" : "Chamada única"} active /><Arrow /><Stage label="Execução server-side" active={version.lifecycle === "tool_cycle"} /><Arrow /><Stage label="Pós-tool" active={version.lifecycle === "tool_cycle"} /><Arrow /><Stage label="Resposta" active /></div></div>
    {version.lifecycle === "tool_cycle" ? <fieldset><legend className="text-sm font-semibold text-slate-ink">Ferramentas autorizadas nesta versão</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{tools.map((tool) => { const checked = version.allowedTools.includes(tool.key); return <label key={tool.key} className="flex items-start gap-3 rounded-lg border border-mist bg-white p-3 text-sm"><input type="checkbox" checked={checked} onChange={() => updateVersion({ allowedTools: checked ? version.allowedTools.filter((item) => item !== tool.key) : [...version.allowedTools, tool.key] })} className="mt-0.5 accent-deep-teal" /><span><strong className="block text-slate-ink">{tool.label}</strong><span className="mt-1 block text-xs text-stone">{tool.description}</span><span className="mt-1 block font-mono text-[11px] text-stone">{tool.key}{tool.mutates ? " · altera dados" : ""}</span></span></label>; })}</div></fieldset> : <p className="border-l-2 border-stone/40 bg-soft-ivory px-4 py-3 text-sm text-stone">Sem pré-chamada e sem tools. O schema exige <code>toolCalls=[]</code>.</p>}
  </div>;
}

function PromptEditor({ version, promptPreviews, structuralPolicy, updateVersion }: { version: FlowVersionView; promptPreviews: Record<string, string>; structuralPolicy: string; updateVersion: (patch: Partial<FlowVersionView>) => void }) {
  return <div className="space-y-5">
    <Field label="Prompt principal do fluxo"><textarea value={version.prompt} onChange={(event) => updateVersion({ prompt: event.target.value })} rows={8} className={`${textareaClass} font-mono text-xs`} /></Field>
    {version.lifecycle === "tool_cycle" && <div className="grid gap-4 lg:grid-cols-2"><Field label="Prompt de pré-tool"><textarea value={version.preToolPrompt} onChange={(event) => updateVersion({ preToolPrompt: event.target.value })} rows={7} className={`${textareaClass} font-mono text-xs`} /></Field><Field label="Prompt de pós-tool"><textarea value={version.postToolPrompt} onChange={(event) => updateVersion({ postToolPrompt: event.target.value })} rows={7} className={`${textareaClass} font-mono text-xs`} /></Field></div>}
    <details className="rounded-lg border border-mist bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-ink">Ver prompts completos da versão publicada</summary><div className="space-y-5 border-t border-mist p-4"><PromptBlock role="system · protegido" content={structuralPolicy} />{Object.entries(promptPreviews).map(([phase, content]) => <PromptBlock key={phase} role={`developer · ${phaseLabel(phase)}`} content={content} />)}<PromptBlock role="user · dinâmico" content={'{"previousSummary":"{{resumo}}","currentFlowState":"{{estado}}","recentMessages":"{{mensagens}}"}'} /><p className="text-xs text-stone">Estes textos vêm do mesmo compilador usado em produção. Os placeholders são substituídos em cada execução.</p></div></details>
  </div>;
}

function OutputSchemas({ schemas, lifecycle }: { schemas: Record<string, unknown>; lifecycle: Lifecycle }) {
  return <div className="space-y-4"><div className="border-l-2 border-deep-teal bg-deep-teal/5 px-4 py-3"><p className="text-sm font-semibold text-slate-ink">Envelope obrigatório do motor</p><p className="mt-1 text-xs leading-5 text-stone">Decisão, resposta, resumo, estado e transição são estáveis para auditoria. <code>continueImmediately</code> permite ao próximo fluxo processar a mesma mensagem, com limite server-side de dois fluxos consecutivos.</p></div><p className="text-xs text-stone">Schemas da versão publicada. Publique alterações de lifecycle e tools para atualizar este contrato.</p><div className="grid gap-4 xl:grid-cols-2">{Object.entries(schemas).map(([phase, schema]) => <section key={phase} className="min-w-0 rounded-lg border border-mist bg-white"><div className="border-b border-mist px-4 py-3"><p className="text-xs font-semibold uppercase text-deep-teal">{phaseLabel(phase)}</p><p className="mt-1 text-xs text-stone">{lifecycle === "tool_cycle" && phase === "post_tool" ? "Não permite solicitar outra tool." : "JSON Schema enviado ao Azure OpenAI."}</p></div><pre className="max-h-[560px] overflow-auto p-4 font-mono text-[11px] leading-5 text-slate-ink">{JSON.stringify(schema, null, 2)}</pre></section>)}</div></div>;
}

function Transitions({ draft, version, flows, updateVersion }: { draft: FlowView; version: FlowVersionView; flows: FlowView[]; updateVersion: (patch: Partial<FlowVersionView>) => void }) {
  return <fieldset><legend className="text-sm font-semibold text-slate-ink">Próximos fluxos permitidos</legend><p className="mt-1 text-xs leading-5 text-stone">O servidor rejeita destinos não selecionados. O modelo pode solicitar continuação imediata quando o destino consegue usar a mesma mensagem; no máximo dois fluxos rodam em sequência.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{flows.filter((flow) => flow.key !== draft.key).map((flow) => { const checked = version.allowedTransitions.includes(flow.key); return <label key={flow.key} className="flex items-start gap-3 rounded-lg border border-mist bg-white p-3 text-sm"><input type="checkbox" checked={checked} onChange={() => updateVersion({ allowedTransitions: checked ? version.allowedTransitions.filter((key) => key !== flow.key) : [...version.allowedTransitions, flow.key] })} className="mt-0.5 accent-deep-teal" /><span><strong className="text-slate-ink">{flow.name}</strong><span className="mt-1 block font-mono text-[11px] text-stone">{flow.key}</span></span></label>; })}</div></fieldset>;
}

function Versions({ draft, flows }: { draft: FlowView; flows: FlowView[] }) {
  return <div className="overflow-x-auto rounded-lg border border-mist bg-white"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-soft-ivory font-semibold uppercase text-stone"><tr><th className="px-4 py-3">Versão</th><th className="px-4 py-3">Publicação</th><th className="px-4 py-3">Lifecycle</th><th className="px-4 py-3">Tools</th><th className="px-4 py-3">Transições</th></tr></thead><tbody className="divide-y divide-mist">{[...draft.versions].sort((a, b) => b.version - a.version).map((version) => <tr key={version.version}><td className="px-4 py-3 font-semibold text-slate-ink">v{version.version}{version.version === draft.currentVersion ? " · atual" : ""}</td><td className="px-4 py-3 text-stone">{formatDateTime(version.createdAt)}</td><td className="px-4 py-3 text-slate-ink">{version.lifecycle === "tool_cycle" ? "Ciclo com tools" : "Chamada única"}</td><td className="px-4 py-3 text-stone">{version.allowedTools.length || "Nenhuma"}</td><td className="px-4 py-3 text-stone">{version.allowedTransitions.map((key) => flows.find((flow) => flow.key === key)?.name ?? key).join(", ") || "Nenhuma"}</td></tr>)}</tbody></table></div>;
}

function GlobalModal({ settings, flows, structuralPolicy, saving, hasChanges, setSettings, close, save }: { settings: GlobalSettings; flows: FlowView[]; structuralPolicy: string; saving: boolean; hasChanges: boolean; setSettings: (settings: GlobalSettings) => void; close: () => void; save: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-ink/45 p-4 py-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section role="dialog" aria-modal="true" aria-labelledby="global-title" className="w-full max-w-3xl space-y-5 rounded-lg bg-white p-5 shadow-xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-deep-teal">Aplicadas a todos os fluxos</p><h2 id="global-title" className="mt-1 font-heading text-xl font-semibold text-slate-ink">Políticas globais</h2><p className="mt-1 text-xs text-stone">Versão {settings.version} · {formatDateTime(settings.updatedAt)}</p></div><button type="button" onClick={close} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-stone hover:bg-soft-ivory" aria-label="Fechar políticas globais">×</button></div><Field label="Fluxo default"><select value={settings.defaultFlowKey} onChange={(event) => setSettings({ ...settings, defaultFlowKey: event.target.value })} className={inputClass}>{flows.filter((flow) => flow.enabled).map((flow) => <option key={flow.key} value={flow.key}>{flow.name}</option>)}</select><small className="mt-1.5 block text-xs font-normal text-stone">Novos contatos começam neste fluxo. Clientes ativos não são movidos.</small></Field><Field label="Comportamento global"><textarea value={settings.globalPrompt} onChange={(event) => setSettings({ ...settings, globalPrompt: event.target.value })} rows={4} className={textareaClass} /></Field><Field label="Conduta diante de ofensas"><textarea value={settings.offensePolicy} onChange={(event) => setSettings({ ...settings, offensePolicy: event.target.value })} rows={3} className={textareaClass} /></Field><Field label="Quando direcionar à equipe humana"><textarea value={settings.handoffPolicy} onChange={(event) => setSettings({ ...settings, handoffPolicy: event.target.value })} rows={4} className={textareaClass} /></Field><details className="rounded-lg border border-mist bg-soft-ivory"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-ink">Política estrutural protegida</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-mist p-4 font-mono text-[11px] leading-5 text-stone">{structuralPolicy}</pre></details><div className="flex justify-end gap-2 border-t border-mist pt-5"><button type="button" onClick={close} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink">Cancelar</button><button type="button" onClick={save} disabled={saving || !hasChanges} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Salvando..." : "Publicar políticas"}</button></div></section></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm font-semibold text-slate-ink">{label}{children}</label>; }
function Badge({ children, strong = false }: { children: ReactNode; strong?: boolean }) { return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${strong ? "bg-deep-teal text-white" : "bg-soft-ivory text-stone"}`}>{children}</span>; }
function Choice({ title, description, checked, click }: { title: string; description: string; checked: boolean; click: () => void }) { return <button type="button" role="radio" aria-checked={checked} onClick={click} className={`rounded-lg border p-4 text-left ${checked ? "border-deep-teal bg-deep-teal/5" : "border-mist bg-white"}`}><span className="text-sm font-semibold text-slate-ink">{title}</span><span className="mt-1 block text-xs leading-5 text-stone">{description}</span></button>; }
function Stage({ label, active }: { label: string; active: boolean }) { return <span className={`w-28 rounded-lg border px-3 py-2 ${active ? "border-deep-teal/30 bg-deep-teal/5 text-deep-teal" : "border-mist bg-soft-ivory text-stone/60"}`}>{label}</span>; }
function Arrow() { return <span aria-hidden="true" className="text-stone">→</span>; }
function PromptBlock({ role, content }: { role: string; content: string }) { return <div><p className="mb-1.5 font-mono text-[10px] font-bold uppercase text-deep-teal">{role}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-soft-ivory p-3 font-mono text-[11px] leading-5 text-slate-ink">{content}</pre></div>; }
function phaseLabel(phase: string) { return phase === "pre_tool" ? "Pré-tool" : phase === "post_tool" ? "Pós-tool" : "Chamada única"; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
