"use client";

import { BookOpen, Braces, CalendarDays, ChevronDown, Database, Gauge, ListOrdered, MessageCircle, Plus, Send, Trash2, UserCheck, Workflow, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

type Tab = "conversation" | "journey" | "knowledge" | "data" | "scheduling" | "tools" | "limits" | "qualification" | "follow_up" | "automation" | "preview";
type Operator = "eq" | "neq" | "is_present" | "is_absent" | "gte" | "lte";
type Condition = { field: string; operator: Operator; value?: string | number | boolean };
type ConditionGroup = { all?: Condition[]; any?: Condition[] };
type ConditionField = {
  key: string;
  label: string;
  group: string;
  description: string;
  values?: Array<{ value: string | number | boolean; label: string }>;
};
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
  journeyPolicy: string;
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

interface FollowUpConfiguration {
  revision: number;
  contentHash: string;
  enabled: boolean;
  intervalMinutes: number;
  activeStartHour: number;
  activeEndHour: number;
  maxHoursSinceInbound: number;
  prompt: string;
  attemptInstructions: string[];
  updatedAt: string;
  updatedBy: string;
}

interface AutomationRule {
  _id: string;
  name: string;
  enabled: boolean;
  process: "customer_agent";
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
  followUp: FollowUpConfiguration;
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

const tabs: Array<{ id: Tab; label: string; group: "Agente" | "Operação" | "Tarefas" | "Técnico"; icon: LucideIcon; description: string; configKey: string }> = [
  { id: "conversation", label: "Conversa", group: "Agente", icon: MessageCircle, description: "Defina como o agente se apresenta, conversa, reage e encaminha atendimentos.", configKey: "agent_config.*Prompt / *Policy" },
  { id: "journey", label: "Jornada", group: "Agente", icon: ListOrdered, description: "Oriente a sequência ideal sem bloquear consultas úteis solicitadas pelo cliente.", configKey: "agent_config.journeyPolicy" },
  { id: "knowledge", label: "Conhecimento", group: "Agente", icon: BookOpen, description: "Mantenha os fatos que o agente pode usar como fonte nas respostas.", configKey: "agent_config.knowledge" },
  { id: "data", label: "Dados", group: "Agente", icon: Database, description: "Escolha quais dados cadastrais o agente coleta e em qual ordem.", configKey: "agent_config.dataCollectionRules" },
  { id: "scheduling", label: "Agenda", group: "Operação", icon: CalendarDays, description: "Monte planos de agendamento usando eventos do calendário e pré-requisitos reais.", configKey: "agent_config.schedulingPlans" },
  { id: "tools", label: "Ferramentas", group: "Operação", icon: Wrench, description: "Autorize ações do agente e oriente quando cada ferramenta deve ser usada.", configKey: "agent_config.enabledTools / toolGuidance" },
  { id: "limits", label: "Execução", group: "Operação", icon: Gauge, description: "Controle a proteção contra loops e o valor do sinal solicitado ao cliente.", configKey: "agent_config.loopPolicy / payment" },
  { id: "qualification", label: "Qualificação", group: "Tarefas", icon: UserCheck, description: "Configure a análise independente de aderência e contexto dos leads.", configKey: "lead_qualification_config" },
  { id: "follow_up", label: "Follow-up", group: "Tarefas", icon: Send, description: "Defina quando e como retomar conversas que ficaram sem resposta.", configKey: "follow_up_config" },
  { id: "automation", label: "Automação", group: "Tarefas", icon: Workflow, description: "Crie gatilhos condicionais para iniciar processos a partir de eventos.", configKey: "automation_rules" },
  { id: "preview", label: "Contrato compilado", group: "Técnico", icon: Braces, description: "Inspecione o prompt e os schemas finais enviados ao modelo.", configKey: "runtime preview · somente leitura" },
];

const inputClass = "mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal outline-none focus:border-deep-teal";
const textareaClass = `${inputClass} resize-y leading-6`;
const buttonClass = "rounded-lg border border-mist bg-white px-3 py-2 text-sm font-semibold text-slate-ink hover:border-deep-teal/50 disabled:opacity-45";

const customerConditionFields: ConditionField[] = [
  { key: "customer.relationshipStatus", label: "Relação com a clínica", group: "Cliente", description: "Novo cliente, retorno ou ainda não identificado.", values: [{ value: "new", label: "Novo cliente" }, { value: "returning", label: "Paciente de retorno" }, { value: "unknown", label: "Não identificado" }] },
  { key: "customer.fullName", label: "Nome completo", group: "Cliente", description: "Nome salvo no cadastro." },
  { key: "customer.birthDate", label: "Data de nascimento", group: "Cliente", description: "Data no formato AAAA-MM-DD." },
  { key: "customer.cpf", label: "CPF", group: "Cliente", description: "CPF mascarado quando já cadastrado." },
  { key: "customer.address.postalCode", label: "CEP", group: "Endereço", description: "CEP do endereço cadastrado." },
  { key: "customer.address.street", label: "Rua", group: "Endereço", description: "Logradouro encontrado pelo CEP." },
  { key: "customer.address.neighborhood", label: "Bairro", group: "Endereço", description: "Bairro do endereço cadastrado." },
  { key: "customer.address.city", label: "Cidade", group: "Endereço", description: "Cidade do endereço cadastrado." },
  { key: "customer.address.state", label: "Estado", group: "Endereço", description: "UF do endereço cadastrado." },
  { key: "customer.address.number", label: "Número do endereço", group: "Endereço", description: "Número do endereço cadastrado." },
  { key: "customer.address.complement", label: "Complemento", group: "Endereço", description: "Complemento do endereço, quando informado." },
  { key: "customer.profession", label: "Profissão", group: "Cliente", description: "Profissão informada pelo cliente." },
];

const collectableDataFields = [
  { key: "relationshipStatus", label: "Relação com a clínica", description: "Identifica se é primeira consulta ou paciente de retorno.", sensitive: false },
  { key: "fullName", label: "Nome completo", description: "Nome usado no cadastro e no atendimento.", sensitive: false },
  { key: "birthDate", label: "Data de nascimento", description: "Data validada no formato brasileiro.", sensitive: true },
  { key: "cpf", label: "CPF", description: "Documento validado e armazenado de forma protegida.", sensitive: true },
  { key: "postalCode", label: "CEP", description: "CEP usado para localizar o endereço.", sensitive: true },
  { key: "addressNumber", label: "Número do endereço", description: "Número que completa o endereço cadastral.", sensitive: true },
  { key: "addressComplement", label: "Complemento", description: "Complemento opcional do endereço.", sensitive: true },
  { key: "secondaryPhones", label: "Telefone secundário", description: "Outro número de contato do cliente.", sensitive: true },
  { key: "profession", label: "Profissão", description: "Profissão informada pelo cliente.", sensitive: true },
] as const;

const schedulingConditionFields: ConditionField[] = [
  ...customerConditionFields,
  { key: "customer.missingFieldsCount", label: "Quantidade de dados obrigatórios pendentes", group: "Cadastro", description: "Número calculado a partir dos campos obrigatórios da aba Dados." },
  { key: "operations.paymentStatus", label: "Status do pagamento", group: "Operação", description: "Estado da solicitação de sinal mais recente.", values: [{ value: "awaiting_human_confirmation", label: "Aguardando confirmação" }, { value: "paid", label: "Pago" }, { value: "rejected", label: "Rejeitado" }] },
];

const automationConditionFields: ConditionField[] = [
  { key: "event.type", label: "Tipo do evento", group: "Evento", description: "Evento que disparou a regra." },
  { key: "customer.serviceStatus", label: "Status do atendimento", group: "Cliente", description: "Responsável atual pelo atendimento.", values: [{ value: "ai_active", label: "Agente ativo" }, { value: "waiting_human", label: "Aguardando humano" }, { value: "human_active", label: "Humano atendendo" }, { value: "closed", label: "Encerrado" }] },
  { key: "customer.profile.capturedFieldCount", label: "Dados cadastrais preenchidos", group: "Cadastro", description: "Quantidade de campos principais já preenchidos." },
  { key: "customer.profile.fullName", label: "Nome completo", group: "Cadastro", description: "Nome salvo no cadastro." },
  { key: "customer.profile.birthDate", label: "Data de nascimento", group: "Cadastro", description: "Data no formato AAAA-MM-DD." },
  { key: "customer.profile.cpf", label: "CPF", group: "Cadastro", description: "CPF mascarado quando já cadastrado." },
  { key: "customer.profile.city", label: "Cidade", group: "Cadastro", description: "Cidade do endereço cadastrado." },
  { key: "customer.profile.state", label: "Estado", group: "Cadastro", description: "UF do endereço cadastrado." },
  { key: "customer.profile.profession", label: "Profissão", group: "Cadastro", description: "Profissão informada pelo cliente." },
];

const automationEventFields: Partial<Record<AutomationRule["event"], ConditionField[]>> = {
  "message.received": [{ key: "event.source", label: "Origem da mensagem", group: "Evento", description: "Presente quando o atendimento é reativado manualmente.", values: [{ value: "status_reactivated", label: "Atendimento reativado" }] }],
  "customer.profile.updated": [{ key: "event.missingFields", label: "Campos cadastrais pendentes", group: "Evento", description: "Lista de chaves que continuam sem preenchimento." }],
  "payment.status.changed": [{ key: "event.status", label: "Novo status do pagamento", group: "Evento", description: "Resultado da revisão do pagamento.", values: [{ value: "paid", label: "Pago" }, { value: "rejected", label: "Rejeitado" }] }],
  "appointment.status.changed": [
    { key: "event.reason", label: "Motivo da alteração na agenda", group: "Evento", description: "Marco que originou a atualização.", values: [{ value: "first_appointment_confirmed", label: "Primeiro agendamento confirmado" }] },
    { key: "event.appointmentId", label: "ID do agendamento", group: "Evento", description: "Identificador do primeiro agendamento confirmado." },
  ],
};

function fieldsForAutomationEvent(event: AutomationRule["event"]) {
  return [...automationConditionFields, ...(automationEventFields[event] ?? [])];
}

export function AgentStudio() {
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [agent, setAgent] = useState<AgentConfiguration | null>(null);
  const [qualification, setQualification] = useState<QualificationConfiguration | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpConfiguration | null>(null);
  const [automation, setAutomation] = useState<AutomationRule[]>([]);
  const [tab, setTab] = useState<Tab>("conversation");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await requestStudioPayload();
    setPayload(data);
    setAgent(structuredClone(data.configuration));
    setQualification(structuredClone(data.qualification));
    setFollowUp(structuredClone(data.followUp));
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
        setFollowUp(structuredClone(data.followUp));
        setAutomation(structuredClone(data.automationRules));
      })
      .catch((error) => { if (active) setFeedback(error instanceof Error ? error.message : "Falha ao carregar configurações."); });
    return () => { active = false; };
  }, []);

  const agentDirty = Boolean(payload && agent && JSON.stringify(payload.configuration) !== JSON.stringify(agent));
  const qualificationDirty = Boolean(payload && qualification && JSON.stringify(payload.qualification) !== JSON.stringify(qualification));
  const followUpDirty = Boolean(payload && followUp && JSON.stringify(payload.followUp) !== JSON.stringify(followUp));
  const automationDirty = Boolean(payload && JSON.stringify(payload.automationRules) !== JSON.stringify(automation));
  const activeTab = tabs.find((item) => item.id === tab) ?? tabs[0];
  const activeDirty = tab === "qualification" ? qualificationDirty : tab === "follow_up" ? followUpDirty : tab === "automation" ? automationDirty : agentDirty;
  const hasUnsavedChanges = agentDirty || qualificationDirty || followUpDirty || automationDirty;

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
        setFollowUp(structuredClone(data.followUp));
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
    if (!payload || !agent || !qualification || !followUp || !activeDirty) return;
    setSaving(true);
    setFeedback("");
    const body = tab === "qualification"
      ? { scope: "qualification", qualification }
      : tab === "follow_up"
        ? { scope: "follow_up", followUp }
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

  if (!payload || !agent || !qualification || !followUp) {
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

    <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
    <nav aria-label="Seções do Agent Studio" className="overflow-x-auto border-b border-mist lg:overflow-visible lg:border-b-0 lg:border-r lg:pr-5">
      <div role="tablist" aria-orientation="vertical" className="flex min-w-max gap-2 pb-3 lg:block lg:min-w-0 lg:space-y-5 lg:pb-0">
        {(["Agente", "Operação", "Tarefas", "Técnico"] as const).map((group) => <div key={group} className="flex gap-1 lg:block lg:space-y-1"><p className="hidden px-3 pb-1 text-[10px] font-semibold uppercase text-stone lg:block">{group}</p>{tabs.filter((item) => item.group === group).map((item) => { const Icon = item.icon; const dirty = item.id === "qualification" ? qualificationDirty : item.id === "follow_up" ? followUpDirty : item.id === "automation" ? automationDirty : item.id === "preview" ? false : agentDirty; return <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setFeedback(""); }} className={`relative inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-semibold lg:flex lg:w-full ${tab === item.id ? "bg-deep-teal text-white" : "text-stone hover:bg-white hover:text-slate-ink"}`}><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="lg:min-w-0 lg:truncate">{item.label}</span>{dirty && <span aria-label="Alterações não salvas" className={`ml-auto h-1.5 w-1.5 rounded-full ${tab === item.id ? "bg-white" : "bg-burnt-coral"}`} />}</button>; })}</div>)}
      </div>
    </nav>

    <div className="min-w-0">
    <div className="border-b border-mist pb-4">
      <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><activeTab.icon aria-hidden="true" className="h-4 w-4" /></span><div><p className="text-[10px] font-semibold uppercase text-deep-teal">{activeTab.group}</p><h2 className="mt-0.5 font-heading text-lg font-semibold text-slate-ink">{activeTab.label}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-stone">{activeTab.description}</p><code className="mt-1.5 block text-[10px] text-stone">{activeTab.configKey}</code></div></div>
    </div>

    <main className="min-h-[520px] py-5">
      {tab === "conversation" && <ConversationEditor value={agent} change={setAgent} />}
      {tab === "journey" && <JourneyEditor value={agent} change={setAgent} />}
      {tab === "knowledge" && <Field label="Conhecimento autorizado" fieldKey="knowledge"><textarea rows={22} value={agent.knowledge} onChange={(event) => setAgent({ ...agent, knowledge: event.target.value })} className={`${textareaClass} font-mono text-xs`} /></Field>}
      {tab === "data" && <DataEditor rules={agent.dataCollectionRules} change={(dataCollectionRules) => setAgent({ ...agent, dataCollectionRules })} />}
      {tab === "scheduling" && <SchedulingEditor plans={agent.schedulingPlans} eventTypes={payload.calendarEventTypes} change={(schedulingPlans) => setAgent({ ...agent, schedulingPlans })} />}
      {tab === "tools" && <ToolsEditor tools={payload.availableTools} enabled={agent.enabledTools} guidance={agent.toolGuidance} change={(enabledTools, toolGuidance) => setAgent({ ...agent, enabledTools, toolGuidance })} />}
      {tab === "limits" && <LimitsEditor value={agent} change={setAgent} />}
      {tab === "qualification" && <QualificationEditor value={qualification} change={setQualification} />}
      {tab === "follow_up" && <FollowUpEditor value={followUp} change={setFollowUp} />}
      {tab === "automation" && <AutomationEditor rules={automation} change={setAutomation} />}
      {tab === "preview" && <Preview value={payload.previews} />}
    </main>

    <footer className="flex items-center justify-between border-t border-mist pt-5">
      <p className="text-xs text-stone">{activeDirty ? "Alterações ainda não salvas" : `Atualizado por ${tab === "qualification" ? qualification.updatedBy : tab === "follow_up" ? followUp.updatedBy : tab === "automation" ? "automação" : agent.updatedBy}`}</p>
      <button type="button" onClick={() => void save()} disabled={!activeDirty || saving || tab === "preview"} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-45">{saving ? "Salvando..." : "Salvar configuração ativa"}</button>
    </footer>
    </div>
    </div>
  </div>;
}

function ConversationEditor({ value, change }: { value: AgentConfiguration; change: (value: AgentConfiguration) => void }) {
  return <div className="grid gap-5 xl:grid-cols-2">
    <Field label="Identidade" fieldKey="identityPrompt"><textarea rows={8} value={value.identityPrompt} onChange={(event) => change({ ...value, identityPrompt: event.target.value })} className={textareaClass} /></Field>
    <Field label="Política de conversa" fieldKey="conversationPolicy"><textarea rows={8} value={value.conversationPolicy} onChange={(event) => change({ ...value, conversationPolicy: event.target.value })} className={textareaClass} /></Field>
    <Field label="Conduta diante de ofensas" fieldKey="offensePolicy"><textarea rows={6} value={value.offensePolicy} onChange={(event) => change({ ...value, offensePolicy: event.target.value })} className={textareaClass} /></Field>
    <Field label="Encaminhamento humano" fieldKey="handoffPolicy"><textarea rows={6} value={value.handoffPolicy} onChange={(event) => change({ ...value, handoffPolicy: event.target.value })} className={textareaClass} /></Field>
  </div>;
}

function JourneyEditor({ value, change }: { value: AgentConfiguration; change: (value: AgentConfiguration) => void }) {
  return <div className="space-y-4">
    <div className="rounded-lg border border-mist bg-soft-ivory p-4 text-sm leading-6 text-stone">
      Esta orientação define a sequência preferida da conversa. Consultas somente leitura continuam disponíveis; pré-requisitos configurados são aplicados pelo servidor apenas ao concluir ações como uma reserva.
    </div>
    <Field label="Ordem e flexibilidade da jornada" fieldKey="journeyPolicy">
      <textarea rows={16} maxLength={8000} value={value.journeyPolicy} onChange={(event) => change({ ...value, journeyPolicy: event.target.value })} className={textareaClass} />
    </Field>
  </div>;
}

function DataEditor({ rules, change }: { rules: AgentConfiguration["dataCollectionRules"]; change: (rules: AgentConfiguration["dataCollectionRules"]) => void }) {
  const [pendingFieldKey, setPendingFieldKey] = useState<string>("");
  const availableFields = collectableDataFields.filter((field) => !rules.some((rule) => rule.fieldKey === field.key));
  const pendingField = availableFields.find((field) => field.key === pendingFieldKey) ?? availableFields[0];
  function update(index: number, patch: Partial<AgentConfiguration["dataCollectionRules"][number]>) {
    change(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }
  function addField() {
    if (!pendingField) return;
    change([...rules, {
      fieldKey: pendingField.key,
      label: pendingField.label,
      purpose: pendingField.description,
      required: false,
      collectionOrder: Math.max(0, ...rules.map((rule) => rule.collectionOrder)) + 10,
      sensitive: pendingField.sensitive,
    }]);
    setPendingFieldKey("");
  }
  return <div className="space-y-4">
    <SectionHeader title="Campos coletados" description="A ordem define o próximo dado faltante que o agente deve solicitar." />
    <div className="flex flex-col gap-2 border-y border-mist py-3 sm:flex-row sm:items-end">
      <Field label="Adicionar campo do cadastro"><select value={pendingField?.key ?? ""} disabled={!pendingField} onChange={(event) => setPendingFieldKey(event.target.value)} className={`${inputClass} min-w-64`}><option value="">{availableFields.length === 0 ? "Todos os campos já foram adicionados" : "Selecione um campo"}</option>{availableFields.map((field) => <option key={field.key} value={field.key}>{field.label} · {field.key}</option>)}</select></Field>
      <button type="button" onClick={addField} disabled={!pendingField} className={`${buttonClass} min-h-10`}><Plus aria-hidden="true" className="mr-1.5 inline h-4 w-4" />Adicionar</button>
    </div>
    <FieldCatalog fields={collectableDataFields.map((field) => ({ key: field.key, label: field.label, group: field.sensitive ? "Dado sensível" : "Cadastro", description: field.description }))} />
    <div className="space-y-3">{[...rules].sort((a, b) => a.collectionOrder - b.collectionOrder).map((rule) => {
      const index = rules.indexOf(rule);
      const definition = collectableDataFields.find((field) => field.key === rule.fieldKey);
      return <section key={`${rule.fieldKey}-${index}`} className="grid gap-3 border-b border-mist pb-4 md:grid-cols-[100px_1fr_1fr_auto]">
        <Field label="Ordem"><input type="number" value={rule.collectionOrder} onChange={(event) => update(index, { collectionOrder: Number(event.target.value) })} className={inputClass} /></Field>
        <Field label="Nome"><input value={rule.label} onChange={(event) => update(index, { label: event.target.value })} className={inputClass} /></Field>
        <div className="pt-0.5"><p className="text-sm font-semibold text-slate-ink">Chave no cadastro</p><code className={`mt-1.5 block rounded-md border px-3 py-2 text-xs ${definition ? "border-mist bg-cloud text-deep-teal" : "border-burnt-coral/40 bg-burnt-coral/5 text-burnt-coral"}`}>{rule.fieldKey}</code>{!definition && <p className="mt-1 text-[11px] text-burnt-coral">Esta chave não é persistida pelo cadastro atual.</p>}</div>
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
    <FieldCatalog fields={eventTypes.map((eventType) => ({ key: eventType.key, label: eventType.name, group: "Tipo de evento", description: `${eventType.durationMinutes} minutos · recurso ${eventType.resourceId}` }))} />
    {plans.length === 0 && <EmptyState title="Nenhum plano configurado" description="Adicione um plano para combinar tipos de evento, ordem e pré-requisitos." />}
    {plans.map((plan, index) => <section key={`${plan.key}-${index}`} className="space-y-5 border-b border-mist pb-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 md:grid-cols-2"><Field label="Nome do plano" fieldKey="name"><input value={plan.name} onChange={(event) => updatePlan(index, { name: event.target.value })} className={inputClass} /></Field><Field label="Chave do plano" fieldKey="key"><input value={plan.key} onChange={(event) => updatePlan(index, { key: event.target.value })} className={`${inputClass} font-mono text-xs`} /></Field></div>
        <div className="flex items-center gap-4 pt-6"><Toggle checked={plan.enabled} onChange={(enabled) => updatePlan(index, { enabled })} label="Ativo" /><button type="button" onClick={() => change(plans.filter((_, planIndex) => planIndex !== index))} className="text-sm font-semibold text-burnt-coral">Remover</button></div>
      </div>
      <Field label="Descrição" fieldKey="description"><input value={plan.description} onChange={(event) => updatePlan(index, { description: event.target.value })} className={inputClass} /></Field>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]"><div><p className="text-sm font-semibold text-slate-ink">Etapas</p><div className="mt-2 space-y-3">{plan.steps.map((step, stepIndex) => <div key={`${step.key}-${stepIndex}`} className="grid gap-2 border-l-2 border-mist pl-3 md:grid-cols-[1fr_1fr_1.2fr_auto]">
        <Field label="Chave" fieldKey="steps[].key"><input aria-label="Chave da etapa" value={step.key} onChange={(event) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, key: event.target.value } : item) })} className={`${inputClass} font-mono text-xs`} /></Field>
        <Field label="Nome" fieldKey="steps[].label"><input aria-label="Nome da etapa" value={step.label} onChange={(event) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, label: event.target.value } : item) })} className={inputClass} /></Field>
        <Field label="Evento do calendário" fieldKey="steps[].eventTypeKey"><select aria-label="Tipo de evento" value={step.eventTypeKey} onChange={(event) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, eventTypeKey: event.target.value } : item) })} className={inputClass}>{eventTypes.map((eventType) => <option key={eventType.key} value={eventType.key}>{eventType.name} · {eventType.durationMinutes} min · {eventType.key}</option>)}</select></Field>
        <div className="flex items-end gap-2"><Toggle checked={step.required} onChange={(required) => updatePlan(index, { steps: plan.steps.map((item, itemIndex) => itemIndex === stepIndex ? { ...item, required } : item) })} label="Obrigatória" /><button type="button" onClick={() => updatePlan(index, { steps: plan.steps.filter((_, itemIndex) => itemIndex !== stepIndex) })} className="pb-2 text-sm text-burnt-coral">Remover</button></div>
      </div>)}</div><button type="button" onClick={() => updatePlan(index, { steps: [...plan.steps, { key: `step_${plan.steps.length + 1}`, eventTypeKey: eventTypes[0]?.key ?? "", label: `Etapa ${plan.steps.length + 1}`, required: true }] })} className={`${buttonClass} mt-3`}>Adicionar etapa</button></div>
      <Field label="Expiração da proposta (minutos)" fieldKey="proposalExpiryMinutes"><input type="number" min={1} value={plan.proposalExpiryMinutes} onChange={(event) => updatePlan(index, { proposalExpiryMinutes: Number(event.target.value) })} className={inputClass} /></Field></div>
      <ConstraintEditor constraints={plan.constraints} steps={plan.steps} change={(constraints) => updatePlan(index, { constraints })} />
      <div><p className="text-sm font-semibold text-slate-ink">Pré-requisitos</p><p className="mt-1 text-xs text-stone">Escolha um dado disponível, a comparação e o valor esperado.</p><ConditionEditor value={plan.prerequisites} fields={schedulingConditionFields} change={(prerequisites) => updatePlan(index, { prerequisites })} /></div>
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
      <Field label="Orientação adicional" fieldKey={`toolGuidance.${tool.key}`}><textarea rows={3} maxLength={2000} disabled={!enabled.includes(tool.key)} value={guidance[tool.key] ?? ""} onChange={(event) => change(enabled, { ...guidance, [tool.key]: event.target.value })} className={`${textareaClass} text-xs`} /></Field>
      <details><summary className="cursor-pointer text-xs font-semibold text-deep-teal">Instruções protegidas</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border-l-2 border-mist pl-3 font-mono text-[11px] leading-5 text-stone">{tool.protectedInstructions}</pre></details>
    </section>)}</div>
  </div>;
}

function LimitsEditor({ value, change }: { value: AgentConfiguration; change: (value: AgentConfiguration) => void }) {
  const fields: Array<{ key: keyof AgentConfiguration["loopPolicy"]; label: string; min: number; max: number }> = [
    { key: "maxModelIterations", label: "Iterações do modelo", min: 2, max: 10 },
    { key: "maxRepeatedInvalidCalls", label: "Chamadas inválidas repetidas", min: 0, max: 3 },
  ];
  return <div className="space-y-7"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{fields.map((field) => <Field key={field.key} label={field.label} fieldKey={`loopPolicy.${field.key}`}><input type="number" min={field.min} max={field.max} value={value.loopPolicy[field.key]} onChange={(event) => change({ ...value, loopPolicy: { ...value.loopPolicy, [field.key]: Number(event.target.value) } })} className={inputClass} /><small className="mt-1 block text-xs font-normal text-stone">Permitido: {field.min} a {field.max}</small></Field>)}</div>
    <section className="border-t border-mist pt-5"><h2 className="text-sm font-semibold text-slate-ink">Pagamento</h2><div className="mt-3 grid gap-4 sm:grid-cols-2"><Field label="Valor do sinal (R$)" fieldKey="payment.signalAmountCents"><input type="number" min={1} max={10000} step="0.01" value={value.payment.signalAmountCents / 100} onChange={(event) => change({ ...value, payment: { ...value.payment, signalAmountCents: Math.round(Number(event.target.value) * 100) } })} className={inputClass} /></Field><div className="pt-7 text-sm text-stone">Credenciais Pix: <strong className="text-slate-ink">{value.payment.configured ? "configuradas" : "não configuradas"}</strong>. A chave nunca é enviada ao Studio.</div></div></section>
  </div>;
}

function QualificationEditor({ value, change }: { value: QualificationConfiguration; change: (value: QualificationConfiguration) => void }) {
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-slate-ink">Qualificação de leads</h2><p className="mt-1 text-xs text-stone">Tarefa separada do agente, usando a mesma infraestrutura de modelo.</p></div><Toggle checked={value.enabled} onChange={(enabled) => change({ ...value, enabled })} label="Ativa" /></div><Field label="Instruções" fieldKey="prompt"><textarea rows={20} value={value.prompt} onChange={(event) => change({ ...value, prompt: event.target.value })} className={`${textareaClass} font-mono text-xs`} /></Field><Field label="Máximo de tokens" fieldKey="maxCompletionTokens"><input type="number" min={512} max={16384} value={value.maxCompletionTokens} onChange={(event) => change({ ...value, maxCompletionTokens: Number(event.target.value) })} className={inputClass} /></Field></div>;
}

function FollowUpEditor({ value, change }: { value: FollowUpConfiguration; change: (value: FollowUpConfiguration) => void }) {
  const startHours = Array.from({ length: 24 }, (_, hour) => hour);
  const endHours = Array.from({ length: 24 }, (_, index) => index + 1);
  const updateAttempt = (index: number, instruction: string) => change({
    ...value,
    attemptInstructions: value.attemptInstructions.map((current, currentIndex) => currentIndex === index ? instruction : current),
  });

  return <div className="space-y-7">
    <label className="inline-flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={value.enabled} onChange={(event) => change({ ...value, enabled: event.target.checked })} className="mt-1 h-4 w-4 accent-deep-teal" />
      <span><span className="block text-base font-semibold text-slate-ink">Follow-up sem resposta</span><span className="mt-1 block text-xs font-normal text-stone">Recontata leads sem consulta futura durante o horário disponível.</span></span>
    </label>

    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Intervalo entre mensagens (minutos)" fieldKey="intervalMinutes"><input type="number" min={2} max={1440} value={value.intervalMinutes} onChange={(event) => change({ ...value, intervalMinutes: Number(event.target.value) })} className={inputClass} /></Field>
      <Field label="Validade após a última mensagem (horas)" fieldKey="maxHoursSinceInbound"><input type="number" min={1} max={24} value={value.maxHoursSinceInbound} onChange={(event) => change({ ...value, maxHoursSinceInbound: Number(event.target.value) })} className={inputClass} /></Field>
    </div>

    <fieldset>
      <legend className="text-sm font-semibold text-slate-ink">Horário disponível</legend>
      <div className="mt-2 grid max-w-xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <Field label="De" fieldKey="activeStartHour"><select value={value.activeStartHour} onChange={(event) => change({ ...value, activeStartHour: Number(event.target.value) })} className={inputClass}>{startHours.map((hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></Field>
        <span className="pb-2.5 text-sm text-stone">às</span>
        <Field label="Até" fieldKey="activeEndHour"><select value={value.activeEndHour} onChange={(event) => change({ ...value, activeEndHour: Number(event.target.value) })} className={inputClass}>{endHours.map((hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></Field>
      </div>
    </fieldset>

    <section className="border-t border-mist pt-6">
      <h3 className="text-sm font-semibold text-slate-ink">Informações adicionais</h3>
      <details className="group mt-3 border-y border-mist">
        <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-semibold text-slate-ink">
          Instruções padrão
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-stone transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-mist pb-4 pt-3"><Field label="Prompt base" fieldKey="prompt"><textarea aria-label="Instruções padrão" rows={12} value={value.prompt} onChange={(event) => change({ ...value, prompt: event.target.value })} className={`${textareaClass} font-mono text-xs`} /></Field></div>
      </details>

      <div className="mt-6 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-ink">Instruções por tentativa</h3>
        <button type="button" onClick={() => change({ ...value, attemptInstructions: [...value.attemptInstructions, ""] })} disabled={value.attemptInstructions.length >= 12} className={buttonClass}><Plus aria-hidden="true" className="mr-1.5 inline h-4 w-4" />Adicionar tentativa</button>
      </div>
      <div className="mt-2 divide-y divide-mist border-y border-mist">
        {value.attemptInstructions.map((instruction, index) => <div key={index} className="grid gap-3 py-4 sm:grid-cols-[110px_minmax(0,1fr)_36px] sm:items-start">
          <label htmlFor={`follow-up-attempt-${index}`} className="pt-2 text-sm font-semibold text-slate-ink">Tentativa {index + 1}</label>
          <textarea id={`follow-up-attempt-${index}`} rows={3} maxLength={2000} value={instruction} onChange={(event) => updateAttempt(index, event.target.value)} className={`${textareaClass} mt-0 text-sm`} />
          <button type="button" title={`Remover instrução da tentativa ${index + 1}`} aria-label={`Remover instrução da tentativa ${index + 1}`} onClick={() => change({ ...value, attemptInstructions: value.attemptInstructions.filter((_, currentIndex) => currentIndex !== index) })} className="mt-1 inline-flex h-9 w-9 items-center justify-center text-burnt-coral hover:text-slate-ink"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
        </div>)}
      </div>
    </section>
  </div>;
}

function AutomationEditor({ rules, change }: { rules: AutomationRule[]; change: (rules: AutomationRule[]) => void }) {
  function update(index: number, patch: Partial<AutomationRule>) { change(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)); }
  return <div className="space-y-5"><SectionHeader title="Gatilhos" description="Eventos criam jobs independentes; debounce agrupa atualizações próximas." action="Adicionar regra" onAction={() => change([...rules, { _id: `rule-${rules.length + 1}`, name: "Nova regra", enabled: false, process: "customer_agent", event: "manual.requested", conditions: {}, debounceMs: 0, cooldownMinutes: 0, rerunWhenSourceChanges: true, updatedAt: new Date().toISOString(), updatedBy: "dashboard" }])} />
    {rules.length === 0 && <EmptyState title="Nenhuma automação configurada" description="Adicione uma regra para executar o agente quando um evento atender às condições escolhidas." />}
    {rules.map((rule, index) => <section key={`${rule._id}-${index}`} className="space-y-4 border-b border-mist pb-6"><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><Field label="Nome"><input value={rule.name} onChange={(event) => update(index, { name: event.target.value })} className={inputClass} /></Field><Field label="Identificador"><input value={rule._id} onChange={(event) => update(index, { _id: event.target.value })} className={inputClass} /></Field><div className="flex items-end gap-4 pb-2"><Toggle checked={rule.enabled} onChange={(enabled) => update(index, { enabled })} label="Ativa" /><button type="button" onClick={() => change(rules.filter((_, ruleIndex) => ruleIndex !== index))} className="text-sm font-semibold text-burnt-coral">Remover</button></div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Processo" fieldKey="process"><select value={rule.process} onChange={(event) => update(index, { process: event.target.value as AutomationRule["process"] })} className={inputClass}><option value="customer_agent">Agente do cliente</option></select></Field><Field label="Evento" fieldKey="event"><select value={rule.event} onChange={(event) => update(index, { event: event.target.value as AutomationRule["event"] })} className={inputClass}><option value="message.received">Mensagem recebida · message.received</option><option value="customer.profile.updated">Cadastro atualizado · customer.profile.updated</option><option value="payment.status.changed">Pagamento alterado · payment.status.changed</option><option value="appointment.status.changed">Agenda alterada · appointment.status.changed</option><option value="manual.requested">Solicitação manual · manual.requested</option></select></Field><Field label="Agrupar eventos por (ms)" fieldKey="debounceMs"><input type="number" min={0} value={rule.debounceMs} onChange={(event) => update(index, { debounceMs: Number(event.target.value) })} className={inputClass} /></Field><Field label="Espera entre execuções (min)" fieldKey="cooldownMinutes"><input type="number" min={0} value={rule.cooldownMinutes} onChange={(event) => update(index, { cooldownMinutes: Number(event.target.value) })} className={inputClass} /></Field></div>
      <Toggle checked={rule.rerunWhenSourceChanges} onChange={(rerunWhenSourceChanges) => update(index, { rerunWhenSourceChanges })} label="Reexecutar quando a origem mudar" />
      <ConditionEditor value={rule.conditions} fields={fieldsForAutomationEvent(rule.event)} change={(conditions) => update(index, { conditions })} />
    </section>)}
  </div>;
}

function ConditionEditor({ value, fields, change }: { value: ConditionGroup; fields: ConditionField[]; change: (value: ConditionGroup) => void }) {
  return <div className="mt-3 space-y-3">
    <FieldCatalog fields={fields} />
    <div className="grid gap-4 xl:grid-cols-2"><ConditionList title="Todas as condições" values={value.all ?? []} fields={fields} change={(all) => change({ ...value, all })} /><ConditionList title="Qualquer condição" values={value.any ?? []} fields={fields} change={(any) => change({ ...value, any })} /></div>
  </div>;
}

function ConditionList({ title, values, fields, change }: { title: string; values: Condition[]; fields: ConditionField[]; change: (values: Condition[]) => void }) {
  const groups = Array.from(new Set(fields.map((field) => field.group)));
  return <fieldset className="border-l-2 border-mist pl-3"><div className="flex items-center justify-between"><legend className="text-xs font-semibold uppercase text-stone">{title}</legend><button type="button" onClick={() => change([...values, { field: fields[0]?.key ?? "", operator: "is_present" }])} className="text-xs font-semibold text-deep-teal">Adicionar condição</button></div><div className="mt-2 space-y-3">{values.map((condition, index) => {
    const selectedField = fields.find((field) => field.key === condition.field);
    const valueDisabled = condition.operator === "is_present" || condition.operator === "is_absent";
    return <div key={index} className="grid grid-cols-[minmax(0,1fr)_36px] gap-2 rounded-md bg-cloud/60 p-3 sm:grid-cols-[minmax(0,1.35fr)_120px_minmax(0,1fr)_36px]">
      <label className="text-xs font-semibold text-stone">Campo<select aria-label="Campo da condição" value={condition.field} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value, value: undefined } : item))} className={inputClass}>{condition.field && !selectedField && <option value={condition.field}>{condition.field} (legado)</option>}{groups.map((group) => <optgroup key={group} label={group}>{fields.filter((field) => field.group === group).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</optgroup>)}</select>{selectedField && <code className="mt-1 block truncate text-[10px] font-normal text-deep-teal" title={selectedField.key}>{selectedField.key}</code>}</label>
      <label className="text-xs font-semibold text-stone">Comparação<select aria-label="Operador" value={condition.operator} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as Operator } : item))} className={inputClass}><option value="eq">é igual a</option><option value="neq">é diferente de</option><option value="is_present">está preenchido</option><option value="is_absent">não está preenchido</option><option value="gte">é maior ou igual</option><option value="lte">é menor ou igual</option></select></label>
      <label className="text-xs font-semibold text-stone">Valor{selectedField?.values && !valueDisabled ? <select aria-label="Valor" value={condition.value === undefined ? "" : String(condition.value)} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, value: scalar(event.target.value) } : item))} className={inputClass}><option value="">Selecione...</option>{selectedField.values.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select> : <input aria-label="Valor" disabled={valueDisabled} value={condition.value === undefined ? "" : String(condition.value)} onChange={(event) => change(values.map((item, itemIndex) => itemIndex === index ? { ...item, value: scalar(event.target.value) } : item))} className={inputClass} />}</label>
      <button type="button" title="Remover condição" aria-label="Remover condição" onClick={() => change(values.filter((_, itemIndex) => itemIndex !== index))} className="mt-5 inline-flex h-9 w-9 items-center justify-center text-burnt-coral"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
    </div>;
  })}</div></fieldset>;
}

function FieldCatalog({ fields }: { fields: ConditionField[] }) {
  return <details className="group border-y border-mist"><summary className="flex cursor-pointer list-none items-center justify-between py-2.5 text-xs font-semibold text-deep-teal"><span className="inline-flex items-center gap-2"><Database aria-hidden="true" className="h-4 w-4" />Ver {fields.length} campos disponíveis</span><ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="grid gap-x-5 gap-y-3 border-t border-mist py-4 sm:grid-cols-2 xl:grid-cols-3">{fields.map((field) => <div key={field.key} className="min-w-0"><div className="flex items-baseline justify-between gap-2"><strong className="text-xs text-slate-ink">{field.label}</strong><span className="text-[10px] uppercase text-stone">{field.group}</span></div><code className="mt-1 block break-all text-[10px] text-deep-teal">{field.key}</code><p className="mt-1 text-[11px] leading-4 text-stone">{field.description}</p></div>)}</div></details>;
}

function Preview({ value }: { value: StudioPayload["previews"] }) {
  return <div className="space-y-5"><PreviewBlock title="Política estrutural protegida" value={value.structuralPolicy} /><PreviewBlock title="Prompt developer compilado" value={value.developerPrompt} /><div className="grid gap-5 xl:grid-cols-2"><PreviewBlock title="Schema iterativo" value={JSON.stringify(value.iterativeSchema, null, 2)} /><PreviewBlock title="Schema da última iteração" value={JSON.stringify(value.finalSchema, null, 2)} /></div></div>;
}

function PreviewBlock({ title, value }: { title: string; value: string }) { return <details className="rounded-lg border border-mist bg-white" open><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-ink">{title}</summary><pre className="max-h-[520px] overflow-auto border-t border-mist p-4 font-mono text-[11px] leading-5 text-slate-ink whitespace-pre-wrap">{value}</pre></details>; }
function EmptyState({ title, description }: { title: string; description: string }) { return <div className="border-y border-dashed border-mist py-10 text-center"><p className="text-sm font-semibold text-slate-ink">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-stone">{description}</p></div>; }
function Field({ label, fieldKey, children }: { label: string; fieldKey?: string; children: ReactNode }) { return <label className="block text-sm font-semibold text-slate-ink"><span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><span>{label}</span>{fieldKey && <code className="text-[10px] font-normal text-stone">{fieldKey}</code>}</span>{children}</label>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-ink"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-deep-teal" />{label}</label>; }
function SectionHeader({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) { return <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-ink">{title}</h2><p className="mt-1 text-xs text-stone">{description}</p></div>{action && onAction && <button type="button" onClick={onAction} className={buttonClass}>{action}</button>}</div>; }
function scalar(value: string): string | number | boolean { if (value === "true") return true; if (value === "false") return false; const number = Number(value); return value.trim() !== "" && Number.isFinite(number) ? number : value; }
function formatHour(hour: number) { return `${String(hour).padStart(2, "0")}:00`; }
function editableAgent(agent: AgentConfiguration) { return { enabled: agent.enabled, identityPrompt: agent.identityPrompt, conversationPolicy: agent.conversationPolicy, offensePolicy: agent.offensePolicy, handoffPolicy: agent.handoffPolicy, journeyPolicy: agent.journeyPolicy, knowledge: agent.knowledge, dataCollectionRules: agent.dataCollectionRules, schedulingPlans: agent.schedulingPlans, enabledTools: agent.enabledTools, toolGuidance: agent.toolGuidance, loopPolicy: agent.loopPolicy, payment: { signalAmountCents: agent.payment.signalAmountCents } }; }
