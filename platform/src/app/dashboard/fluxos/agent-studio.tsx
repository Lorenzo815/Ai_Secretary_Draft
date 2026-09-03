"use client";

import { useEffect, useState, type ReactNode } from "react";

type Tab = "conversation" | "knowledge" | "data" | "scheduling" | "tools" | "limits" | "qualification" | "automation" | "preview";
type Operator = "eq" | "neq" | "is_present" | "is_absent" | "gte" | "lte";
type Condition = { field: string; operator: Operator; value?: string | number | boolean };
type ConditionGroup = { all?: Condition[]; any?: Condition[] };
type Constraint =
  | { type: "ordered"; before: string; after: string }
  | { type: "gap"; from: string; to: string; minMinutes: number; maxMinutes: number }
  | { type: "same_day"; steps: string[] };

interface AgentConfiguration {
  revision: number;
  contentHash: string;
  enabled: boolean;
  identityPrompt: string;
  conversationPolicy: string;
  offensePolicy: string;
  handoffPolicy: string;
  knowledge: string;
  dataCollectionRules: Array<{
    fieldKey: string;
    label: string;
    purpose: string;
    required: boolean;
    collectionOrder: number;
    sensitive: boolean;
  }>;
  schedulingPlans: Array<{
    key: string;
    name: string;
    description: string;
    enabled: boolean;
    steps: Array<{ key: string; eventTypeKey: string; label: string; required: boolean }>;
    constraints: Constraint[];
    prerequisites: ConditionGroup;
    proposalExpiryMinutes: number;
  }>;
  enabledTools: string[];
  toolGuidance: Record<string, string>;
  loopPolicy: {
    maxModelIterations: number;
    maxToolExecutions: number;
    maxMutations: number;
    maxRepeatedInvalidCalls: number;
  };
  payment: { configured: boolean; signalAmountCents: number };
  updatedAt: string;
  updatedBy: string;
}

interface QualificationConfiguration {
  revision: number;
  contentHash: string;
  enabled: boolean;
  prompt: string;
  maxCompletionTokens: number;
  updatedAt: string;
  updatedBy: string;
}

interface AutomationRule {
  _id: string;
  name: string;
  enabled: boolean;
  process: "customer_agent" | "lead_qualification";
  event: "message.received" | "customer.profile.updated" | "payment.status.changed" | "appointment.status.changed" | "manual.requested";
  conditions: ConditionGroup;
  debounceMs: number;
  cooldownMinutes: number;
  rerunWhenSourceChanges: boolean;
  updatedAt: string;
  updatedBy: string;
}

interface StudioPayload {
  configuration: AgentConfiguration;
  qualification: QualificationConfiguration;
  automationRules: AutomationRule[];
  availableTools: Array<{ key: string; label: string; description: string; mutates: boolean; protectedInstructions: string }>;
  calendarEventTypes: Array<{ key: string; name: string; durationMinutes: number; resourceId: string }>;
  previews: { structuralPolicy: string; developerPrompt: string; iterativeSchema: unknown; finalSchema: unknown };
}

async function requestStudioPayload() {
  const response = await fetch("/api/assistant/studio", { cache: "no-store" });
  const data = await response.json() as StudioPayload & { error?: string };
  if (!response.ok || !data.configuration) throw new Error(data.error ?? "Não foi possível carregar o Agent Studio.");
  return data;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "conversation", label: "Conversa" },
  { id: "knowledge", label: "Conhecimento" },
  { id: "data", label: "Dados" },
  { id: "scheduling", label: "Agenda" },
  { id: "tools", label: "Ferramentas" },
  { id: "limits", label: "Limites" },
  { id: "qualification", label: "Qualificação" },
  { id: "automation", label: "Automação" },
  { id: "preview", label: "Contrato compilado" },
];

const inputClass = "mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal outline-none focus:border-deep-teal";
const textareaClass = `${inputClass} resize-y leading-6`;
const buttonClass = "rounded-lg border border-mist bg-white px-3 py-2 text-sm font-semibold text-slate-ink hover:border-deep-teal/50 disabled:opacity-45";

export function AgentStudio() {
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [agent, setAgent] = useState<AgentConfiguration | null>(null);
  const [qualification, setQualification] = useState<QualificationConfiguration | null>(null);
  const [automation, setAutomation] = useState<AutomationRule[]>([]);
  const [tab, setTab] = useState<Tab>("conversation");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await requestStudioPayload();
    setPayload(data);
    setAgent(structuredClone(data.configuration));
    setQualification(structuredClone(data.qualification));
    setAutomation(structuredClone(data.automationRules));
  }

  useEffect(() => {
    let active = true;
    void requestStudioPayload()
      .then((data) => {
        if (!active) return;
        setPayload(data);
        setAgent(structuredClone(data.configuration));
        setQualification(structuredClone(data.qualification));
        setAutomation(structuredClone(data.automationRules));
      })
      .catch((error) => { if (active) setFeedback(error instanceof Error ? error.message : "Falha ao carregar configurações."); });
    return () => { active = false; };
  }, []);

  const agentDirty = Boolean(payload && agent && JSON.stringify(payload.configuration) !== JSON.stringify(agent));
  const qualificationDirty = Boolean(payload && qualification && JSON.stringify(payload.qualification) !== JSON.stringify(qualification));
  const automationDirty = Boolean(payload && JSON.stringify(payload.automationRules) !== JSON.stringify(automation));
  const activeDirty = tab === "qualification" ? qualificationDirty : tab === "automation" ? automationDirty : agentDirty;
  const hasUnsavedChanges = agentDirty || qualificationDirty || automationDirty;

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;

    async function refreshInBackground() {
      if (document.visibilityState !== "visible" || hasUnsavedChanges || saving || refreshInFlight) return;
      refreshInFlight = true;
      try {
        const data = await requestStudioPayload();
        if (!active || document.visibilityState !== "visible") return;
        setPayload(data);
        setAgent(structuredClone(data.configuration));
        setQualification(structuredClone(data.qualification));
        setAutomation(structuredClone(data.automationRules));
      } catch {
        // A later poll retries without replacing the current editor state.
      } finally {
        refreshInFlight = false;
      }
    }

    const interval = window.setInterval(refreshInBackground, 10_000);
    document.addEventListener("visibilitychange", refreshInBackground);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [hasUnsavedChanges, saving]);

  async function save() {
    if (!payload || !agent || !qualification || !activeDirty) return;
    setSaving(true);
    setFeedback("");
    const body = tab === "qualification"
      ? { scope: "qualification", qualification }
      : tab === "automation"
        ? { scope: "automation", automationRules: automation }
        : { scope: "agent", expectedRevision: agent.revision, configuration: editableAgent(agent) };
    try {
      const response = await fetch("/api/assistant/studio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      await load();
      setFeedback("Configuração ativa atualizada.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (!payload || !agent || !qualification) {
    return <p className="py-16 text-center text-sm text-stone">{feedback || "Carregando Agent Studio..."}</p>;
  }

  return <div className="animate-fade-in-up space-y-5" data-auto-refresh-dirty={hasUnsavedChanges ? "true" : undefined}>
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-mist pb-5">
      <div>
        <p className="text-sm font-medium text-deep-teal">Automação</p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Agent Studio</h1>
        <p className="mt-2 text-sm text-stone">Configuração ativa do atendimento, regras operacionais e tarefas auxiliares.</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-stone">Revisão {agent.revision}</span>
        <Toggle checked={agent.enabled} onChange={(enabled) => setAgent({ ...agent, enabled })} label="Agente ativo" />
      </div>
    </header>

    {feedback && <div className="flex items-center justify-between gap-3 border-l-2 border-deep-teal bg-deep-teal/5 px-4 py-3 text-sm text-slate-ink"><span>{feedback}</span>{feedback.includes("Recarregue") && <button type="button" onClick={() => void load()} className="font-semibold text-deep-teal">Recarregar</button>}</div>}

    <nav aria-label="Seções do Agent Studio" className="overflow-x-auto border-b border-mist">
      <div role="tablist" className="flex min-w-max gap-5">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setFeedback(""); }} className={`border-b-2 px-1 pb-3 text-sm font-semibold ${tab === item.id ? "border-deep-teal text-deep-teal" : "border-transparent text-stone hover:text-slate-ink"}`}>{item.label}</button>)}
      </div>
    </nav>

    <main className="min-h-[520px] py-2">
      {tab === "conversation" && <ConversationEditor value={agent} change={setAgent} />}
      {tab === "knowledge" && <Field label="Conhecimento autorizado"><textarea rows={22} value={agent.knowledge} onChange={(event) => setAgent({ ...agent, knowledge: event.target.value })} className={`${textareaClass} font-mono text-xs`} /></Field>}
      {tab === "data" && <DataEditor rules={agent.dataCollectionRules} change={(dataCollectionRules) => setAgent({ ...agent, dataCollectionRules })} />}
      {tab === "scheduling" && <SchedulingEditor plans={agent.schedulingPlans} eventTypes={payload.calendarEventTypes} change={(schedulingPlans) => setAgent({ ...agent, schedulingPlans })} />}
      {tab === "tools" && <ToolsEditor tools={payload.availableTools} enabled={agent.enabledTools} guidance={agent.toolGuidance} change={(enabledTools, toolGuidance) => setAgent({ ...agent, enabledTools, toolGuidance })} />}
      {tab === "limits" && <LimitsEditor value={agent} change={setAgent} />}
      {tab === "qualification" && <QualificationEditor value={qualification} change={setQualification} />}
      {tab === "automation" && <AutomationEditor rules={automation} change={setAutomation} />}
      {tab === "preview" && <Preview value={payload.previews} />}
    </main>

    <footer className="flex items-center justify-between border-t border-mist pt-5">
      <p className="text-xs text-stone">{activeDirty ? "Alterações ainda não salvas" : `Atualizado por ${tab === "qualification" ? qualification.updatedBy : tab === "automation" ? "automação" : agent.updatedBy}`}</p>
      <button type="button" onClick={() => void save()} disabled={!activeDirty || saving || tab === "preview"} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-45">{saving ? "Salvando..." : "Salvar configuração ativa"}</button>
    </footer>
  </div>;
}

function ConversationEditor({ value, change }: { value: AgentConfiguration; change: (value: AgentConfiguration) => void }) {
  return <div className="grid gap-5 xl:grid-cols-2">
    <Field label="Identidade"><textarea rows={8} value={value.identityPrompt} onChange={(event) => change({ ...value, identityPrompt: event.target.value })} className={textareaClass} /></Field>
    <Field label="Política de conversa"><textarea rows={8} value={value.conversationPolicy} onChange={(event) => change({ ...value, conversationPolicy: event.target.value })} className={textareaClass} /></Field>
    <Field label="Conduta diante de ofensas"><textarea rows={6} value={value.offensePolicy} onChange={(event) => change({ ...value, offensePolicy: event.target.value })} className={textareaClass} /></Field>
    <Field label="Encaminhamento humano"><textarea rows={6} value={value.handoffPolicy} onChange={(event) => change({ ...value, handoffPolicy: event.target.value })} className={textareaClass} /></Field>
  </div>;
}

function DataEditor({ rules, change }: { rules: AgentConfiguration["dataCollectionRules"]; change: (rules: AgentConfiguration["dataCollectionRules"]) => void }) {
  function update(index: number, patch: Partial<AgentConfiguration["dataCollectionRules"][number]>) {
    change(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }
  return <div className="space-y-4">
    <SectionHeader title="Campos coletados" description="A ordem define o próximo dado faltante que o agente deve solicitar." action="Adicionar campo" onAction={() => change([...rules, { fieldKey: `field_${rules.length + 1}`, label: "Novo campo", purpose: "", required: false, collectionOrder: (rules.at(-1)?.collectionOrder ?? 0) + 10, sensitive: false }])} />
    <div className="space-y-3">{[...rules].sort((a, b) => a.collectionOrder - b.collectionOrder).map((rule) => {
      const index = rules.indexOf(rule);
      return <section key={`${rule.fieldKey}-${index}`} className="grid gap-3 border-b border-mist pb-4 md:grid-cols-[100px_1fr_1fr_auto]">
        <Field label="Ordem"><input type="number" value={rule.collectionOrder} onChange={(event) => update(index, { collectionOrder: Number(event.target.value) })} className={inputClass} /></Field>
        <Field label="Chave"><input value={rule.fieldKey} onChange={(event) => update(index, { fieldKey: event.target.value })} className={inputClass} /></Field>
        <Field label="Nome"><input value={rule.label} onChange={(event) => update(index, { label: event.target.value })} className={inputClass} /></Field>
        <button type="button" onClick={() => change(rules.filter((_, ruleIndex) => ruleIndex !== index))} className="self-end px-2 py-2 text-sm font-semibold text-burnt-coral">Remover</button>
        <div className="md:col-span-3"><Field label="Finalidade"><input value={rule.purpose} onChange={(event) => update(index, { purpose: event.target.value })} className={inputClass} /></Field></div>
        <div className="flex items-end gap-4"><Toggle checked={rule.required} onChange={(required) => update(index, { required })} label="Obrigatório" /><Toggle checked={rule.sensitive} onChange={(sensitive) => update(index, { sensitive })} label="Sensível" /></div>
      </section>;
    })}</div>
  </div>;
}

function SchedulingEditor({ plans, eventTypes, change }: { plans: AgentConfiguration["schedulingPlans"]; eventTypes: StudioPayload["calendarEventTypes"]; change: (plans: AgentConfiguration["schedulingPlans"]) => void }) {
  function updatePlan(index: number, patch: Partial<AgentConfiguration["schedulingPlans"][number]>) {
    change(plans.map((plan, planIndex) => planIndex === index ? { ...plan, ...patch } : plan));
  }
  function addPlan() {
    change([...plans, { key: `plan_${plans.length + 1}`, name: "Novo plano", description: "", enabled: false, steps: [{ key: "step_1", eventTypeKey: eventTypes[0]?.key ?? "", label: "Etapa 1", required: true }], constraints: [], prerequisites: {}, proposalExpiryMinutes: 60 }]);
  }
  return <div className="space-y-6">
    <SectionHeader title="Planos de agendamento" description="Cada proposta usa eventos configurados no calendário e restrições validadas pelo servidor." action="Adicionar plano" onAction={addPlan} />
    {plans.map((plan, index) => <section key={`${plan.key}-${index}`} className="space-y-5 border-b border-mist pb-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 md:grid-cols-2"><Field label="Nome"><input value={plan.name} onChange={(event) => updatePlan(index, { name: event.target.value })} className={inputClass} /></Field><Field label="Chave"><input value={plan.key} onChange={(event) => updatePlan(index, { key: event.target.value })} className={inputClass} /></Field></div>
        <div className="flex items-center gap-4 pt-6"><Toggle checked={plan.enabled} onChange={(enabled) => updatePlan(index, { enabled })} label="Ativo" /><button type="button" onClick={() => change(plans.filter((_, planIndex) => planIndex !== index))} className="text-sm font-semibold text-burnt-coral">Remover</button></div>
      </div>
      <Field label="Descrição"><input value={plan.description} onChange={(event) => updatePlan(index, { description: event.target.value })} className={inputClass} /></Field>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]"><div><p className="text-sm font-semibold text-slate-ink">Etapas</p><div className="mt-2 space-y-2">{plan.steps.map((step, stepIndex) => <div key={`${step.key}-${stepIndex}`} className="grid gap-2 border-l-2 border-mist pl-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <input aria-label="Chave da etapa" value={step.key} onChange={(event) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, key: event.target.value } : item) })} className={inputClass} />
        <input aria-label="Nome da etapa" value={step.label} onChange={(event) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, label: event.target.value } : item) })} className={inputClass} />
        <select aria-label="Tipo de evento" value={step.eventTypeKey} onChange={(event) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, eventTypeKey: event.target.value } : item) })} className={inputClass}>{eventTypes.map((eventType) => <option key={eventType.key} value={eventType.key}>{eventType.name} · {eventType.durationMinutes} min</option>)}</select>
        <div className="flex items-end gap-2"><Toggle checked={step.required} onChange={(required) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, required } : item) })} label="Obrigatória" /><button type="button" onClick={() => updatePlan(index, { steps: plan.steps.filter((_, itemIndex) => itemIndex !== stepIndex) })} className="pb-2 text-sm text-burnt-coral">Remover</button></div>
      </div>)}</div><button type="button" onClick={() => updatePlan(index, { steps: [...plan.steps, { key: `step_${plan.steps.length + 1}`, eventTypeKey: eventTypes[0]?.key ?? "", label: `Etapa ${plan.steps.length + 1}`, required: true }] })} className={`${buttonClass} mt-3`}>Adicionar etapa</button></div>
      <Field label="Expiração da proposta (minutos)"><input type="number" min={1} value={plan.proposalExpiryMinutes} onChange={(event) => updatePlan(index, { proposalExpiryMinutes: Number(event.target.value) })} className={inputClass} /></Field></div>
      <ConstraintEditor constraints={plan.constraints} steps={plan.steps} change={(constraints) => updatePlan(index, { constraints })} />
      <div><p className="text-sm font-semibold text-slate-ink">Pré-requisitos</p><p className="mt-1 text-xs text-stone">Exemplos: customer.missingFieldsCount eq 0; operations.paymentStatus eq paid.</p><ConditionEditor value={plan.prerequisites} change={(prerequisites) => updatePlan(index, { prerequisites })} /></div>
    </section>)}
  </div>;
}

function ConstraintEditor({ constraints, steps, change }: { constraints: Constraint[]; steps: AgentConfiguration["schedulingPlans"][number]["steps"]; change: (constraints: Constraint[]) => void }) {
  const first = steps[0]?.key ?? "";
  const second = steps[1]?.key ?? first;
  function update(index: number, constraint: Constraint) { change(constraints.map((item, itemIndex) => itemIndex === index ? constraint : item)); }
  return <div><div className="flex items-center justify-between"><p className="text-sm font-semibold text-slate-ink">Restrições</p><button type="button" disabled={steps.length < 2} onClick={() => change([...constraints, { type: "ordered", before: first, after: second }])} className={buttonClass}>Adicionar restrição</button></div>
    <div className="mt-2 space-y-2">{constraints.map((constraint, index) => <div key={index} className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
      <select value={constraint.type} onChange={(event) => { const type = event.target.value; update(index, type === "gap" ? { type, from: first, to: second, minMinutes: 0, maxMinutes: 1440 } : type === "same_day" ? { type, steps: [first, second] } : { type: "ordered", before: first, after: second }); }} className={inputClass}><option value="ordered">Ordem</option><option value="gap">Intervalo</option><option value="same_day">Mesmo dia</option></select>
      {constraint.type === "ordered" && <div className="grid grid-cols-2 gap-2"><StepSelect value={constraint.before} steps={steps} change={(before) => update(index, { ...constraint, before })} /><StepSelect value={constraint.after} steps={steps} change={(after) => update(index, { ...constraint, after })} /></div>}
      {constraint.type === "gap" && <div className="grid grid-cols-4 gap-2"><StepSelect value={constraint.from} steps={steps} change={(from) => update(index, { ...constraint, from })} /><StepSelect value={constraint.to} steps={steps} change={(to) => update(index, { ...constraint, to })} /><input aria-label="Intervalo mínimo" type="number" value={constraint.minMinutes} onChange={(event) => update(index, { ...constraint, minMinutes: Number(event.target.value) })} className={inputClass} /><input aria-label="Intervalo máximo" type="number" value={constraint.maxMinutes} onChange={(event) => update(index, { ...constraint, maxMinutes: Number(event.target.value) })} className={inputClass} /></div>}
      {constraint.type === "same_day" && <div className="flex flex-wrap items-center gap-3 pt-2">{steps.map((step) => <label key={step.key} className="flex items-center gap-2 text-sm text-stone"><input type="checkbox" checked={constraint.steps.includes(step.key)} onChange={() => update(index, { ...constraint, steps: constraint.steps.includes(step.key) ? constraint.steps.filter((key) => key !== step.key) : [...constraint.steps, step.key] })} className="accent-deep-teal" />{step.label}</label>)}</div>}
      <button type="button" onClick={() => change(constraints.filter((_, itemIndex) => itemIndex !== index))} className="self-end px-2 py-2 text-sm text-burnt-coral">Remover</button>
    </div>)}</div>
  </div>;
}

function StepSelect({ value, steps, change }: { value: string; steps: AgentConfiguration["schedulingPlans"][number]["steps"]; change: (value: string) => void }) {
  return <select value={value} onChange={(event) => change(event.target.value)} className={inputClass}>{steps.map((step) => <option key={step.key} value={step.key}>{step.label}</option>)}</select>;
}

function ToolsEditor({ tools, enabled, guidance, change }: { tools: StudioPayload["availableTools"]; enabled: string[]; guidance: Record<string, string>; change: (enabled: string[], guidance: Record<string, string>) => void }) {
  return <div className="space-y-3"><SectionHeader title="Ferramentas autorizadas" description="Schema, segurança e regras de propriedade são protegidos. A orientação adicional apenas ajusta o uso pelo modelo." />
    <div className="grid gap-3 lg:grid-cols-2">{tools.map((tool) => <section key={tool.key} className="space-y-3 rounded-lg border border-mist bg-white p-4">
      <label className="flex items-start gap-3"><input type="checkbox" checked={enabled.includes(tool.key)} onChange={() => change(enabled.includes(tool.key) ? enabled.filter((key) => key !== tool.key) : [...enabled, tool.key], guidance)} className="mt-1 accent-deep-teal" /><span><strong className="text-sm text-slate-ink">{tool.label}</strong><span className="mt-1 block text-xs leading-5 text-stone">{tool.description}</span><span className="mt-1 block font-mono text-[11px] text-stone">{tool.key}{tool.mutates ? " · altera dados" : ""}</span></span></label>
      <Field label="Orientação adicional"><textarea rows={3} maxLength={2000} disabled={!enabled.includes(tool.key)} value={guidance[tool.key] ?? ""} onChange={(event) => change(enabled, { ...guidance, [tool.key]: event.target.value })} className={`${textareaClass} text-xs`} /></Field>
      <details><summary className="cursor-pointer text-xs font-semibold text-deep-teal">Instruções protegidas</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border-l-2 border-mist pl-3 font-mono text-[11px] leading-5 text-stone">{tool.protectedInstructions}</pre></details>
    </section>)}</div>
  </div>;
}

function LimitsEditor({ value, change }: { value: AgentConfiguration; change: (value: AgentConfiguration) => void }) {
  const fields: Array<{ key: keyof AgentConfiguration["loopPolicy"]; label: string; min: number; max: number }> = [
    { key: "maxModelIterations", label: "Iterações do modelo", min: 2, max: 10 },
    { key: "maxToolExecutions", label: "Execuções de ferramentas", min: 1, max: 8 },
    { key: "maxMutations", label: "Mutações por job", min: 0, max: 4 },
    { key: "maxRepeatedInvalidCalls", label: "Chamadas inválidas repetidas", min: 0, max: 3 },
  ];
  return <div className="space-y-7"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{fields.map((field) => <Field key={field.key} label={field.label}><input type="number" min={field.min} max={field.max} value={value.loopPolicy[field.key]} onChange={(event) => change({ ...value, loopPolicy: { ...value.loopPolicy, [field.key]: Number(event.target.value) } })} className={inputClass} /><small className="mt-1 block text-xs font-normal text-stone">Permitido: {field.min} a {field.max}</small></Field>)}</div>
    <section className="border-t border-mist pt-5"><h2 className="text-sm font-semibold text-slate-ink">Pagamento</h2><div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label="Sinal (centavos)"><input type="number" min={100} max={1000000} value={value.payment.signalAmountCents} onChange={(event) => change({ ...value, payment: { ...value.payment, signalAmountCents: Number(event.target.value) } })} className={inputClass} /></Field><div className="pt-7 text-sm text-stone">Credenciais Pix: <strong className="text-slate-ink">{value.payment.configured ? "configuradas" : "não configuradas"}</strong>. A chave nunca é enviada ao Studio.</div></div></section>
  </div>;
}

function QualificationEditor({ value, change }: { value: QualificationConfiguration; change: (value: QualificationConfiguration) => void }) {
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-slate-ink">Qualificação de leads</h2><p className="mt-1 text-xs text-stone">Tarefa separada do agente, usando a mesma infraestrutura de modelo.</p></div><Toggle checked={value.enabled} onChange={(enabled) => change({ ...value, enabled })} label="Ativa" /></div><Field label="Instruções"><textarea rows={20} value={value.prompt} onChange={(event) => change({ ...value, prompt: event.target.value })} className={`${textareaClass} font-mono text-xs`} /></Field><Field label="Máximo de tokens"><input type="number" min={512} max={16384} value={value.maxCompletionTokens} onChange={(event) => change({ ...value, maxCompletionTokens: Number(event.target.value) })} className={inputClass} /></Field></div>;
}

function AutomationEditor({ rules, change }: { rules: AutomationRule[]; change: (rules: AutomationRule[]) => void }) {
  function update(index: number, patch: Partial<AutomationRule>) { change(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)); }
  return <div className="space-y-5"><SectionHeader title="Gatilhos" description="Eventos criam jobs independentes; debounce agrupa atualizações próximas." action="Adicionar regra" onAction={() => change([...rules, { _id: `rule-${rules.length + 1}`, name: "Nova regra", enabled: false, process: "customer_agent", event: "manual.requested", conditions: {}, debounceMs: 0, cooldownMinutes: 0, rerunWhenSourceChanges: true, updatedAt: new Date().toISOString(), updatedBy: "dashboard" }])} />
    {rules.map((rule, index) => <section key={`${rule._id}-${index}`} className="space-y-4 border-b border-mist pb-6"><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><Field label="Nome"><input value={rule.name} onChange={(event) => update(index, { name: event.target.value })} className={inputClass} /></Field><Field label="Identificador"><input value={rule._id} onChange={(event) => update(index, { _id: event.target.value })} className={inputClass} /></Field><div className="flex items-end gap-4 pb-2"><Toggle checked={rule.enabled} onChange={(enabled) => update(index, { enabled })} label="Ativa" /><button type="button" onClick={() => change(rules.filter((_, ruleIndex) => ruleIndex !== index))} className="text-sm font-semibold text-burnt-coral">Remover</button></div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Processo"><select value={rule.process} onChange={(event) => update(index, { process: event.target.value as AutomationRule["process"] })} className={inputClass}><option value="customer_agent">Agente do cliente</option><option value="lead_qualification">Qualificação</option></select></Field><Field label="Evento"><select value={rule.event} onChange={(event) => update(index, { event: event.target.value as AutomationRule["event"] })} className={inputClass}><option value="message.received">Mensagem recebida</option><option value="customer.profile.updated">Cadastro atualizado</option><option value="payment.status.changed">Pagamento alterado</option><option value="appointment.status.changed">Agenda alterada</option><option value="manual.requested">Solicitação manual</option></select></Field><Field label="Debounce (ms)"><input type="number" value={rule.debounceMs} onChange={(event) => update(index, { debounceMs: Number(event.target.value) })} className={inputClass} /></Field><Field label="Cooldown (min)"><input type="number" value={rule.cooldownMinutes} onChange={(event) => update(index, { cooldownMinutes: Number(event.target.value) })} className={inputClass} /></Field></div>
      <Toggle checked={rule.rerunWhenSourceChanges} onChange={(rerunWhenSourceChanges) => update(index, { rerunWhenSourceChanges })} label="Reexecutar quando a origem mudar" />
      <ConditionEditor value={rule.conditions} change={(conditions) => update(index, { conditions })} />
    </section>)}
  </div>;
}

function ConditionEditor({ value, change }: { value: ConditionGroup; change: (value: ConditionGroup) => void }) {
  return <div className="mt-3 grid gap-4 xl:grid-cols-2"><ConditionList title="Todas as condições" values={value.all ?? []} change={(all) => change({ ...value, all })} /><ConditionList title="Qualquer condição" values={value.any ?? []} change={(any) => change({ ...value, any })} /></div>;
}

function ConditionList({ title, values, change }: { title: string; values: Condition[]; change: (values: Condition[]) => void }) {
  return <fieldset><div className="flex items-center justify-between"><legend className="text-xs font-semibold uppercase text-stone">{title}</legend><button type="button" onClick={() => change([...values, { field: "", operator: "is_present" }])} className="text-xs font-semibold text-deep-teal">Adicionar</button></div><div className="mt-2 space-y-2">{values.map((condition, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto]"><input aria-label="Caminho do fato" value={condition.field} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value } : item))} placeholder="customer.profile.city" className={inputClass} /><select aria-label="Operador" value={condition.operator} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as Operator } : item))} className={inputClass}><option value="eq">igual</option><option value="neq">diferente</option><option value="is_present">presente</option><option value="is_absent">ausente</option><option value="gte">maior/igual</option><option value="lte">menor/igual</option></select><input aria-label="Valor" disabled={condition.operator === "is_present" || condition.operator === "is_absent"} value={condition.value === undefined ? "" : String(condition.value)} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, value: scalar(event.target.value) } : item))} className={inputClass} /><button type="button" aria-label="Remover condição" onClick={() => change(values.filter((_, itemIndex) => itemIndex !== index))} className="self-end px-2 py-2 text-burnt-coral">×</button></div>)}</div></fieldset>;
}

function Preview({ value }: { value: StudioPayload["previews"] }) {
  return <div className="space-y-5"><PreviewBlock title="Política estrutural protegida" value={value.structuralPolicy} /><PreviewBlock title="Prompt developer compilado" value={value.developerPrompt} /><div className="grid gap-5 xl:grid-cols-2"><PreviewBlock title="Schema iterativo" value={JSON.stringify(value.iterativeSchema, null, 2)} /><PreviewBlock title="Schema da última iteração" value={JSON.stringify(value.finalSchema, null, 2)} /></div></div>;
}

function PreviewBlock({ title, value }: { title: string; value: string }) { return <details className="rounded-lg border border-mist bg-white" open><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-ink">{title}</summary><pre className="max-h-[520px] overflow-auto border-t border-mist p-4 font-mono text-[11px] leading-5 text-slate-ink whitespace-pre-wrap">{value}</pre></details>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm font-semibold text-slate-ink">{label}{children}</label>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-ink"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-deep-teal" />{label}</label>; }
function SectionHeader({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) { return <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-ink">{title}</h2><p className="mt-1 text-xs text-stone">{description}</p></div>{action && onAction && <button type="button" onClick={onAction} className={buttonClass}>{action}</button>}</div>; }
function scalar(value: string): string | number | boolean { if (value === "true") return true; if (value === "false") return false; const number = Number(value); return value.trim() !== "" && Number.isFinite(number) ? number : value; }
function editableAgent(agent: AgentConfiguration) { return { enabled: agent.enabled, identityPrompt: agent.identityPrompt, conversationPolicy: agent.conversationPolicy, offensePolicy: agent.offensePolicy, handoffPolicy: agent.handoffPolicy, knowledge: agent.knowledge, dataCollectionRules: agent.dataCollectionRules, schedulingPlans: agent.schedulingPlans, enabledTools: agent.enabledTools, toolGuidance: agent.toolGuidance, loopPolicy: agent.loopPolicy, payment: { signalAmountCents: agent.payment.signalAmountCents } }; }
