"use client";

import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { Bot, BrainCircuit, Check, CheckCircle2, ChevronDown, CircleAlert, KeyRound, LoaderCircle, RefreshCw, Save, Search, Trash2 } from "lucide-react";

type Provider = "vercel" | "azure";
type TaskKey = "customer_agent" | "lead_qualification";
type AzureModel = "gpt-5.4" | "gpt-5.4-mini";

interface Configuration {
  revision: number;
  activeProvider: Provider;
  tasks: Record<TaskKey, { vercelModel: string; vercelProvider: string; azureModel: AzureModel }>;
}

interface ModelEndpoint {
  provider: string;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  uptimeLastHour: number | null;
  supportsStructuredOutput: boolean;
  zeroDataRetention: boolean;
}

interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextWindow: number | null;
  maxTokens: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
  suitabilityIndex: number;
}

interface ApiResult {
  configuration?: Configuration;
  status?: {
    vercelConfigured: boolean;
    azureConfigured: boolean;
    vercelCredentialSource: "environment" | "database" | null;
    vercelEnvironmentConfigured: boolean;
    vercelDatabaseConfigured: boolean;
    credentialStorageConfigured: boolean;
    credentialKind: "api_key" | "oidc" | "unknown" | null;
  };
  models?: CatalogModel[];
  endpoints?: ModelEndpoint[];
  health?: { provider: Provider; model: string; mode: "connection" | "model"; inferenceProvider: string | null; durationMs: number; checkedAt: string };
  diagnostic?: { upstreamStatus: number | null; code: string | null; type: string | null; requestId: string | null };
  error?: string;
}

const TASKS: Array<{ key: TaskKey; title: string; description: string; icon: typeof Bot }> = [
  { key: "customer_agent", title: "Conversa com clientes", description: "Respostas, decisões e uso de ferramentas no atendimento.", icon: Bot },
  { key: "lead_qualification", title: "Qualificação de leads", description: "Extração de estágio, intenção, perfil e próximo passo.", icon: BrainCircuit },
];
const AZURE_MODELS: AzureModel[] = ["gpt-5.4-mini", "gpt-5.4"];

export default function AiModelSettings() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [baseline, setBaseline] = useState("");
  const [status, setStatus] = useState<ApiResult["status"]>();
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [azurePassword, setAzurePassword] = useState("");
  const [savingCredential, setSavingCredential] = useState(false);
  const [health, setHealth] = useState<{ state: "idle" | "checking" | "working" | "failed"; text: string }>({ state: "idle", text: "Ainda não testado." });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const dirty = Boolean(configuration && JSON.stringify(configuration) !== baseline);
  const healthProvider = configuration?.activeProvider;
  const healthModel = configuration?.tasks.customer_agent.vercelModel;

  useEffect(() => {
    let active = true;
    fetch("/api/settings/ai-models")
      .then(async (response) => {
        const result = await response.json() as ApiResult;
        if (!response.ok || !result.configuration || !result.status) throw new Error(result.error ?? "Não foi possível carregar os modelos.");
        if (!active) return;
        setConfiguration(result.configuration);
        setBaseline(JSON.stringify(result.configuration));
        setStatus(result.status);
        setModels(result.models ?? []);
      })
      .catch((error) => active && setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível carregar os modelos." }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (healthProvider !== "vercel" || !healthModel) return;
    let active = true;
    setHealth({ state: "checking", text: "Testando conexão..." });
    fetch("/api/settings/ai-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "vercel", model: healthModel }),
    }).then(async (response) => {
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.health) throw new Error(result.error ?? "O teste de conexão falhou.");
      if (active) setHealth({ state: "working", text: `Gateway acessível · ${result.health.durationMs} ms` });
    }).catch((error) => {
      if (active) setHealth({ state: "failed", text: error instanceof Error ? error.message : "O teste de conexão falhou." });
    });
    return () => { active = false; };
  }, [healthProvider, healthModel]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configuration) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/ai-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: configuration.revision,
          activeProvider: configuration.activeProvider,
          azurePassword: configuration.activeProvider === "azure" ? azurePassword : undefined,
          tasks: configuration.tasks,
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.configuration) throw new Error(result.error ?? "Não foi possível salvar os modelos.");
      setConfiguration(result.configuration);
      setBaseline(JSON.stringify(result.configuration));
      setStatus(result.status);
      setAzurePassword("");
      setMessage({ tone: "success", text: "Roteamento e modelos atualizados." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível salvar os modelos." });
    } finally {
      setSaving(false);
    }
  }

  async function updateCredential(clear = false) {
    setSavingCredential(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/ai-models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clear ? { clear: true } : { apiKey }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.status) throw new Error(result.error ?? "Não foi possível atualizar a chave Vercel.");
      setStatus(result.status);
      setApiKey("");
      setMessage({ tone: "success", text: clear ? "Chave armazenada removida." : "Chave Vercel armazenada com criptografia." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível atualizar a chave Vercel." });
    } finally {
      setSavingCredential(false);
    }
  }

  function setProvider(provider: Provider) {
    setConfiguration((current) => current ? { ...current, activeProvider: provider } : current);
    setMessage(null);
    if (provider === "vercel") {
      setAzurePassword("");
    } else {
      setHealth({ state: "idle", text: "Informe a senha protegida para autorizar e testar o Azure." });
    }
  }

  async function checkHealth(
    provider: Provider,
    model: string,
    mode: "connection" | "model" = "connection",
    inferenceProvider?: string,
  ) {
    setHealth({ state: "checking", text: mode === "model" ? `Executando resposta real em ${model}...` : "Testando conexão..." });
    try {
      const response = await fetch("/api/settings/ai-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, mode, inferenceProvider, azurePassword: provider === "azure" ? azurePassword : undefined }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.health) throw new Error(result.error ?? "O teste de conexão falhou.");
      setHealth({ state: "working", text: mode === "model"
        ? `Modelo respondeu · ${result.health.durationMs} ms · ${result.health.inferenceProvider ?? "roteamento automático"}`
        : provider === "vercel"
          ? `Gateway acessível · ${result.health.durationMs} ms`
        : `Operacional · ${result.health.durationMs} ms · ${result.health.model}` });
    } catch (error) {
      setHealth({ state: "failed", text: error instanceof Error ? error.message : "O teste de conexão falhou." });
    }
  }

  function setTaskModel(taskKey: TaskKey, field: "vercelModel" | "vercelProvider" | "azureModel", value: string) {
    setConfiguration((current) => current ? {
      ...current,
      tasks: {
        ...current.tasks,
        [taskKey]: {
          ...current.tasks[taskKey],
          [field]: value,
          ...(field === "vercelModel" ? { vercelProvider: "auto" } : {}),
        },
      },
    } as Configuration : current);
    setMessage(null);
  }

  if (loading) return <div className="flex min-h-44 items-center justify-center rounded-lg border border-mist bg-white text-sm font-medium text-stone"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Consultando catálogo de modelos...</div>;
  if (!configuration || !status) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm font-medium text-red-700">{message?.text ?? "Configuração de modelos indisponível."}</div>;

  const selectedProvider = configuration.activeProvider;
  const selectedModel = selectedProvider === "vercel" ? configuration.tasks.customer_agent.vercelModel : configuration.tasks.customer_agent.azureModel;
  const selectedInferenceProvider = configuration.tasks.customer_agent.vercelProvider;

  return <form onSubmit={save} className="overflow-hidden rounded-lg border border-mist bg-white shadow-sm" data-auto-refresh-dirty={dirty || saving ? "true" : undefined}>
    <div className="grid gap-5 border-b border-mist p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div>
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><BrainCircuit className="h-5 w-5" /></span><div><h3 className="font-heading text-base font-semibold text-slate-ink">Provedor de IA ativo</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-stone">As chamadas usam somente o provedor selecionado. Falhas de configuração ou resposta são exibidas sem troca automática para o Azure.</p></div></div>
        <div className={`mt-4 flex items-start gap-2 rounded-md px-3 py-2.5 text-xs font-medium ${health.state === "working" ? "bg-emerald-50 text-emerald-700" : health.state === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          {health.state === "checking" ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : health.state === "working" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <span><strong>{selectedProvider === "vercel" ? "Vercel AI Gateway" : "Azure OpenAI"}:</strong> {health.text}</span>
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-slate-ink">Provedor ativo</legend>
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-mist bg-white p-1">
          {(["vercel", "azure"] as const).map((provider) => <label key={provider} className={`flex min-h-9 cursor-pointer items-center justify-center rounded px-4 text-sm font-semibold transition-colors ${configuration.activeProvider === provider ? "bg-slate-ink text-white" : "text-stone hover:bg-pearl"}`}><input type="radio" name="provider" value={provider} checked={configuration.activeProvider === provider} onChange={() => setProvider(provider)} className="sr-only" />{provider === "vercel" ? "Vercel" : "Azure"}</label>)}
        </div>
        {selectedProvider === "azure" && <label className="mt-3 block text-xs font-semibold text-slate-ink">Senha do endpoint protegido
          <input type="password" value={azurePassword} onChange={(event) => setAzurePassword(event.target.value)} autoComplete="off" placeholder="Senha necessária" className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" />
        </label>}
        <div className="mt-2 grid gap-2">
          <button type="button" onClick={() => checkHealth(selectedProvider, selectedModel)} disabled={health.state === "checking" || (selectedProvider === "azure" && !azurePassword)} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-mist px-3 text-xs font-semibold text-slate-ink disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Testar conexão</button>
          <button type="button" onClick={() => checkHealth(selectedProvider, selectedModel, "model", selectedProvider === "vercel" && selectedInferenceProvider !== "auto" ? selectedInferenceProvider : undefined)} disabled={health.state === "checking" || (selectedProvider === "azure" && !azurePassword)} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-ink px-3 text-xs font-semibold text-white disabled:opacity-50"><Bot className="h-3.5 w-3.5" />Testar modelo</button>
        </div>
      </fieldset>
    </div>

    <section aria-labelledby="vercel-credential-title" className="grid gap-4 border-b border-mist px-5 py-5 sm:px-6 lg:grid-cols-[minmax(190px,0.7fr)_minmax(0,1.3fr)]">
      <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-warm-sand text-deep-teal"><KeyRound className="h-4 w-4" /></span><div><h4 id="vercel-credential-title" className="font-heading text-sm font-semibold text-slate-ink">Credencial Vercel</h4><p className="mt-1 text-xs leading-5 text-stone">{status.vercelCredentialSource === "environment" ? "Ativa pela variável AI_GATEWAY_API_KEY." : status.vercelCredentialSource === "database" ? "Ativa pelo banco criptografado." : "Nenhuma chave ativa."}</p></div></div>
      <div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1 text-xs font-semibold text-slate-ink">Nova AI Gateway API key
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder="vck_..." disabled={!status.credentialStorageConfigured || savingCredential} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal disabled:bg-pearl" />
          </label>
          <button type="button" onClick={() => updateCredential()} disabled={!status.credentialStorageConfigured || apiKey.trim().length < 20 || savingCredential} className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><KeyRound className="h-4 w-4" />{savingCredential ? "Salvando..." : "Armazenar"}</button>
          {status.vercelDatabaseConfigured && <button type="button" onClick={() => updateCredential(true)} disabled={savingCredential} title="Remover somente a chave armazenada no banco" className="mt-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" />Remover</button>}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-stone">A variável de ambiente sempre tem prioridade sobre a chave armazenada. O valor da chave nunca é exibido.</p>
        {status.credentialKind === "unknown" && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">A credencial ativa não parece ser uma AI Gateway API key. Crie uma chave no painel AI Gateway da Vercel e substitua o valor armazenado.</p>}
        {!status.credentialStorageConfigured && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">Configure AI_CREDENTIALS_ENCRYPTION_KEY com 32 bytes em Base64 para habilitar o armazenamento.</p>}
      </div>
    </section>

    <div className="divide-y divide-mist">
      {TASKS.map((task) => <TaskModelRow key={task.key} task={task} values={configuration.tasks[task.key]} models={models} onChange={(field, value) => setTaskModel(task.key, field, value)} />)}
    </div>

    <div className="flex flex-col gap-3 border-t border-mist bg-pearl/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-h-5">{message && <p role="status" className={`flex items-center gap-1.5 text-sm font-semibold ${message.tone === "success" ? "text-deep-teal" : "text-red-700"}`}>{message.tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}{message.text}</p>}</div>
      <button type="submit" disabled={!dirty || saving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Salvando..." : "Salvar roteamento"}</button>
    </div>
  </form>;
}

function TaskModelRow({ task, values, models, onChange }: {
  task: typeof TASKS[number];
  values: Configuration["tasks"][TaskKey];
  models: CatalogModel[];
  onChange: (field: "vercelModel" | "vercelProvider" | "azureModel", value: string) => void;
}) {
  const Icon = task.icon;
  const selected = models.find((model) => model.id === values.vercelModel);
  return <section aria-labelledby={`${task.key}-title`} className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(190px,0.7fr)_minmax(0,1.3fr)]">
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-warm-sand text-deep-teal"><Icon className="h-4 w-4" /></span><div><h4 id={`${task.key}-title`} className="font-heading text-sm font-semibold text-slate-ink">{task.title}</h4><p className="mt-1 text-xs leading-5 text-stone">{task.description}</p></div></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.65fr)]">
      <div className="min-w-0 text-xs font-semibold text-slate-ink">Modelo no Vercel AI Gateway
        <ModelPicker models={models} value={values.vercelModel} onChange={(value) => onChange("vercelModel", value)} />
        <ModelDetails model={selected} />
        <EndpointPicker key={values.vercelModel} model={values.vercelModel} value={values.vercelProvider} onChange={(value) => onChange("vercelProvider", value)} />
      </div>
      <label className="text-xs font-semibold text-slate-ink">Modelo no Azure
        <select value={values.azureModel} onChange={(event) => onChange("azureModel", event.target.value)} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal">
          {AZURE_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
        <span className="mt-2 block text-[11px] font-normal leading-4 text-stone">Usado somente quando o Azure for selecionado e autorizado.</span>
      </label>
    </div>
  </section>;
}

function EndpointPicker({ model, value, onChange }: { model: string; value: string; onChange: (value: string) => void }) {
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/settings/ai-models?model=${encodeURIComponent(model)}`)
      .then(async (response) => {
        const result = await response.json() as ApiResult;
        if (!response.ok || !result.endpoints) throw new Error(result.error ?? "Não foi possível consultar os provedores.");
        if (active) setEndpoints(result.endpoints);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Não foi possível consultar os provedores."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [model]);

  const selectedExists = value === "auto" || endpoints.some((endpoint) => endpoint.provider === value);
  const selected = endpoints.find((endpoint) => endpoint.provider === value);
  return <div className="mt-3 border-t border-mist pt-3">
    <label className="block text-xs font-semibold text-slate-ink">Provedor de inferência
      <select value={selectedExists ? value : "auto"} onChange={(event) => onChange(event.target.value)} disabled={loading || Boolean(error)} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal disabled:bg-pearl">
        <option value="auto">Automático · Gateway escolhe</option>
        {endpoints.map((endpoint) => <option key={endpoint.provider} value={endpoint.provider}>{endpoint.provider} · In {formatPrice(endpoint.inputPricePerMillion)} · Out {formatPrice(endpoint.outputPricePerMillion)}</option>)}
      </select>
    </label>
    {loading && <span className="mt-1.5 block text-[11px] font-normal text-stone">Consultando preços por provedor...</span>}
    {error && <span role="alert" className="mt-1.5 block text-[11px] font-normal text-red-700">{error}</span>}
    {!loading && !error && selected && <span className="mt-1.5 block text-[11px] font-normal leading-4 text-stone">Uptime 1h: {formatPercent(selected.uptimeLastHour)} · {selected.zeroDataRetention ? "ZDR disponível" : "ZDR não informado"} · {selected.supportsStructuredOutput ? "Saída estruturada" : "Saída estruturada não anunciada"}</span>}
    <span className="mt-1 block text-[11px] font-normal leading-4 text-stone">A escolha fixa restringe a execução a esse provedor. Automático prioriza disponibilidade do Gateway.</span>
  </div>;
}

type SortMode = "index" | "input" | "output" | "context" | "name";

function ModelPicker({ models, value, onChange }: { models: CatalogModel[]; value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [maxPrice, setMaxPrice] = useState("");
  const [minimumIndex, setMinimumIndex] = useState(0);
  const [imagesOnly, setImagesOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("index");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("pt-BR"));
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  const priceLimit = maxPrice === "" ? null : Number(maxPrice);
  const results = models.filter((model) => {
    const searchable = `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase("pt-BR");
    const withinPrice = priceLimit === null || (
      (model.inputPricePerMillion ?? Infinity) <= priceLimit
      && (model.outputPricePerMillion ?? Infinity) <= priceLimit
    );
    return searchable.includes(deferredQuery)
      && (provider === "all" || model.provider === provider)
      && withinPrice
      && (!imagesOnly || model.supportsImages)
      && model.suitabilityIndex >= minimumIndex;
  }).sort((left, right) => compareModels(left, right, sort));
  const selected = models.find((model) => model.id === value);

  return <details className="group relative mt-1.5 rounded-md border border-mist bg-white font-normal open:border-deep-teal">
    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm text-slate-ink marker:hidden"><span className="min-w-0 truncate">{selected ? `${selected.name} · ${selected.id}` : value}</span><ChevronDown className="h-4 w-4 shrink-0 text-stone transition-transform group-open:rotate-180" /></summary>
    <div className="border-t border-mist p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="relative sm:col-span-2"><span className="sr-only">Buscar modelo</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, ID ou fabricante" className="min-h-10 w-full rounded-md border border-mist pl-9 pr-3 text-sm outline-none focus:border-deep-teal" /></label>
        <label><span className="sr-only">Filtrar por fabricante</span><select value={provider} onChange={(event) => setProvider(event.target.value)} className="min-h-10 w-full rounded-md border border-mist bg-white px-2 text-sm outline-none focus:border-deep-teal"><option value="all">Todos os fabricantes</option>{providers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span className="sr-only">Ordenar modelos</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="min-h-10 w-full rounded-md border border-mist bg-white px-2 text-sm outline-none focus:border-deep-teal"><option value="index">Maior Índice Oria</option><option value="input">Menor preço de entrada</option><option value="output">Menor preço de saída</option><option value="context">Maior contexto</option><option value="name">Nome</option></select></label>
        <label className="text-[11px] text-stone">Preço máximo US$/1M<input type="number" min="0" step="0.1" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Sem limite" className="mt-1 min-h-9 w-full rounded-md border border-mist px-2 text-sm text-slate-ink outline-none focus:border-deep-teal" /></label>
        <label className="text-[11px] text-stone sm:col-span-1 xl:col-span-2">Índice Oria mínimo: <strong className="text-slate-ink">{minimumIndex}</strong><input type="range" min="0" max="100" step="5" value={minimumIndex} onChange={(event) => setMinimumIndex(Number(event.target.value))} className="mt-2 block w-full accent-deep-teal" /></label>
        <label className="flex min-h-9 items-center gap-2 self-end pb-2 text-[11px] font-semibold text-slate-ink"><input type="checkbox" checked={imagesOnly} onChange={(event) => setImagesOnly(event.target.checked)} className="h-4 w-4 accent-deep-teal" />Aceita imagens</label>
        <p className="self-end pb-2 text-right text-[11px] text-stone">{results.length} de {models.length} modelos</p>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto border-y border-mist">
        {results.map((model) => <button type="button" key={model.id} onClick={() => onChange(model.id)} className={`grid w-full gap-1 border-b border-mist px-3 py-2.5 text-left last:border-b-0 hover:bg-pearl sm:grid-cols-[minmax(0,1fr)_auto] ${model.id === value ? "bg-deep-teal/5" : ""}`}><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold text-slate-ink">{model.id === value && <Check className="h-3.5 w-3.5 text-deep-teal" />}{model.name}</span><span className="block truncate text-[11px] text-stone">{model.id} · {model.provider}</span></span><span className="flex flex-wrap items-center gap-x-3 text-[11px] text-stone sm:justify-end"><strong title="Índice técnico calculado por capacidades anunciadas, contexto e saída; não é benchmark de inteligência." className="text-deep-teal">Oria {model.suitabilityIndex}</strong><span>In {formatPrice(model.inputPricePerMillion)}</span><span>Out {formatPrice(model.outputPricePerMillion)}</span><span>{formatTokens(model.contextWindow)} ctx</span></span></button>)}
        {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-stone">Nenhum modelo corresponde aos filtros.</p>}
      </div>
    </div>
  </details>;
}

function compareModels(left: CatalogModel, right: CatalogModel, sort: SortMode) {
  if (sort === "index") return right.suitabilityIndex - left.suitabilityIndex || left.name.localeCompare(right.name);
  if (sort === "input") return (left.inputPricePerMillion ?? Infinity) - (right.inputPricePerMillion ?? Infinity);
  if (sort === "output") return (left.outputPricePerMillion ?? Infinity) - (right.outputPricePerMillion ?? Infinity);
  if (sort === "context") return (right.contextWindow ?? -1) - (left.contextWindow ?? -1);
  return left.name.localeCompare(right.name);
}

function ModelDetails({ model }: { model?: CatalogModel }) {
  if (!model) return <span className="mt-2 block text-[11px] font-normal leading-4 text-stone">Metadados indisponíveis para o modelo salvo.</span>;
  return <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-normal leading-4 text-stone sm:grid-cols-4">
    <span><strong className="text-slate-ink">ID</strong><br />{model.id}</span>
    <span><strong className="text-slate-ink">Contexto</strong><br />{formatTokens(model.contextWindow)}</span>
    <span><strong className="text-slate-ink">Entrada / 1M</strong><br />{formatPrice(model.inputPricePerMillion)}</span>
    <span><strong className="text-slate-ink">Saída / 1M</strong><br />{formatPrice(model.outputPricePerMillion)}</span>
    <span title="Índice técnico baseado em capacidades anunciadas; não é benchmark de inteligência."><strong className="text-slate-ink">Índice Oria</strong><br />{model.suitabilityIndex}/100</span>
    <span className="col-span-2 sm:col-span-3"><strong className="text-slate-ink">Capacidades anunciadas</strong><br />{[model.supportsReasoning && "Raciocínio", model.supportsTools && "Ferramentas", model.supportsImages && "Imagens", model.supportsStructuredOutput && "Saída estruturada"].filter(Boolean).join(" · ") || "Nenhuma informada"}</span>
    {!model.supportsImages && <span className="col-span-2 font-semibold text-amber-700 sm:col-span-4">Este modelo não aceita imagens. Selecione “Aceita imagens” no filtro para processar fotos recebidas pelo WhatsApp.</span>}
  </span>;
}

function formatTokens(value: number | null) {
  return value === null ? "Não informado" : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPrice(value: number | null) {
  return value === null ? "Não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "Não informado" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
}