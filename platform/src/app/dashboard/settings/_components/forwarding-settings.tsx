"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, FlaskConical, LoaderCircle, MessageCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  FORWARDING_DEFAULT_RETRIES, FORWARDING_ENDPOINT_LIMIT, FORWARDING_MAX_RETRIES,
  type ForwardingEndpoint, type ForwardingResult, type ForwardingSettings, type ForwardingStats,
} from "@/lib/whatsapp/forwarding-contracts";
import {
  CALENDAR_DEFAULT_STATUSES, CALENDAR_DEFAULT_TRIGGERS, CALENDAR_FORWARDING_STATUSES, CALENDAR_FORWARDING_TRIGGERS,
  CALENDAR_STATUS_LABELS, CALENDAR_TRIGGER_LABELS,
  type CalendarForwardingEndpoint, type CalendarForwardingSettings,
} from "@/lib/calendar/forwarding-contracts";

interface PanelSettings<E extends ForwardingEndpoint> {
  revision: number;
  endpoints: E[];
  stats: ForwardingStats;
}

interface ApiResult<S> {
  settings?: S;
  result?: ForwardingResult | null;
  error?: string;
}

/** Encaminhamentos: WhatsApp (Meta) webhooks and calendar events, each with its own destinations. */
export default function ForwardingSettings({ companyName }: { companyName: string }) {
  return <div className="space-y-5">
    <ForwardingPanel<ForwardingEndpoint, ForwardingSettings>
      api="/api/company/webhook-forwarding"
      icon={<MessageCircle className="h-5 w-5" />}
      title="Webhooks do WhatsApp (Meta)"
      companyName={companyName}
      intro={<>
        <p>Todos os payloads POST válidos da Meta são enviados sem alteração, inclusive mensagens, mídias e status, com a assinatura original (X-Hub-Signature-256). A verificação GET não é encaminhada.</p>
        <p>Ativar um destino exige o WhatsApp da empresa conectado.</p>
      </>}
      newEndpoint={() => ({ id: crypto.randomUUID(), name: "", url: "", enabled: false, maxRetries: FORWARDING_DEFAULT_RETRIES })}
    />
    <ForwardingPanel<CalendarForwardingEndpoint, CalendarForwardingSettings>
      api="/api/company/calendar-forwarding"
      icon={<CalendarClock className="h-5 w-5" />}
      title="Eventos da agenda"
      companyName={companyName}
      intro={<>
        <p>Um JSON (<code>object: &quot;oria.calendar_event&quot;</code>, cabeçalho <code>X-Oria-Event: calendar.appointment</code>) para cada evento gravado na agenda, criado pela IA ou pela equipe, conforme os filtros de cada destino.</p>
        <p>Inclui o tipo, a data, o horário e o status do evento e os dados do paciente no CRM: nome, telefones, data de nascimento, endereço e profissão. O CPF não é enviado. Não há assinatura: use apenas URLs HTTPS que você controla.</p>
        <p>Ao ativar o primeiro destino, os eventos que já existem não são reenviados; só o que acontecer a partir de então.</p>
      </>}
      newEndpoint={(settings) => ({
        id: crypto.randomUUID(), name: "", url: "", enabled: false, maxRetries: FORWARDING_DEFAULT_RETRIES,
        triggers: [...CALENDAR_DEFAULT_TRIGGERS], statuses: [...CALENDAR_DEFAULT_STATUSES],
        eventTypes: settings.eventTypes.map((eventType) => eventType.key),
      })}
      normalize={(settings) => ({
        ...settings,
        // Event types removed from the calendar don't count as a pending change.
        endpoints: settings.endpoints.map((endpoint) => ({
          ...endpoint, eventTypes: endpoint.eventTypes.filter((key) => settings.eventTypes.some((eventType) => eventType.key === key)),
        })),
      })}
      filters={(endpoint, update, settings) => <CalendarFilters endpoint={endpoint} update={update} eventTypes={settings.eventTypes} />}
    />
  </div>;
}

function ForwardingPanel<E extends ForwardingEndpoint, S extends PanelSettings<E>>({ api, icon, title, companyName, intro, newEndpoint, normalize, filters }: {
  api: string;
  icon: ReactNode;
  title: string;
  companyName: string;
  intro: ReactNode;
  newEndpoint: (settings: S) => E;
  normalize?: (settings: S) => S;
  filters?: (endpoint: E, update: (patch: Partial<E>) => void, settings: S) => ReactNode;
}) {
  const [settings, setSettings] = useState<S | null>(null);
  const [endpoints, setEndpoints] = useState<E[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [busy, setBusy] = useState<string | null>("load");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(endpoints) !== baseline;

  function apply(received: S) {
    const next = normalize ? normalize(received) : received;
    setSettings(next);
    setEndpoints(next.endpoints);
    setBaseline(JSON.stringify(next.endpoints));
  }

  useEffect(() => {
    let active = true;
    fetch(api, { cache: "no-store" }).then(async response => {
      const result = await response.json() as ApiResult<S>;
      if (!response.ok || !result.settings) throw new Error(result.error ?? "Não foi possível carregar os encaminhamentos.");
      if (active) apply(result.settings);
    }).catch(error => {
      if (active) setMessage({ error: true, text: error instanceof Error ? error.message : "Falha ao carregar os encaminhamentos." });
    }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function update(id: string, patch: Partial<E>) {
    setEndpoints(current => current.map(endpoint => endpoint.id === id ? { ...endpoint, ...patch } : endpoint));
    setMessage(null);
  }

  async function perform(action: "save" | "refresh" | "test", endpointId?: string) {
    setBusy(endpointId ?? action);
    setMessage(null);
    try {
      const response = await fetch(api, action === "refresh" ? { cache: "no-store" } : {
        method: action === "save" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save" ? { revision: settings?.revision, endpoints } : { endpointId }),
      });
      const result = await response.json() as ApiResult<S>;
      if (!response.ok || !result.settings) throw new Error(result.error ?? "Não foi possível concluir a operação.");
      apply(result.settings);
      if (action === "test") {
        setMessage({
          error: !result.result?.ok,
          text: result.result?.ok
            ? `Teste aceito: HTTP 200 em ${result.result.durationMs} ms. Confirme o processamento na plataforma de destino.`
            : result.result?.error ?? "O teste foi cancelado porque o destino ou a empresa mudou.",
        });
      } else if (action === "save") setMessage({ error: false, text: "Encaminhamentos salvos." });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Falha ao atualizar os encaminhamentos." });
    } finally { setBusy(null); }
  }

  return <section aria-label={title} data-auto-refresh-dirty={dirty ? "true" : undefined} className="space-y-5 rounded-lg border border-mist bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal">{icon}</span>
        <div>
          <h3 className="font-heading text-base font-semibold text-slate-ink">{title}</h3>
          <p className="mt-1 text-sm text-stone">Destinos exclusivos de {companyName}. Apenas o administrador pode configurar e testar.</p>
        </div>
      </div>
      <button type="button" disabled={Boolean(busy) || dirty} onClick={() => void perform("refresh")} className="inline-flex items-center gap-2 rounded-lg border border-mist px-3 py-2 text-sm font-semibold text-deep-teal disabled:opacity-50"><RefreshCw className="h-4 w-4" />Atualizar</button>
    </div>
    <div className="space-y-1 rounded-lg bg-warm-sand/50 p-3 text-sm leading-6 text-stone">{intro}</div>
    {settings && <StatsSummary stats={settings.stats} />}
    {message && <p role={message.error ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${message.error ? "bg-red-50 text-red-700" : "bg-deep-teal/10 text-deep-teal"}`}>{message.text}</p>}
    {!settings && busy && <p className="flex items-center gap-2 text-sm text-stone"><LoaderCircle className="h-4 w-4 animate-spin" />Carregando encaminhamentos...</p>}
    {settings && <form onSubmit={event => { event.preventDefault(); void perform("save"); }} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-ink">Destinos · {endpoints.length}/{FORWARDING_ENDPOINT_LIMIT}</p>
        <button type="button" disabled={Boolean(busy) || endpoints.length >= FORWARDING_ENDPOINT_LIMIT} onClick={() => setEndpoints(current => [...current, newEndpoint(settings)])} className="inline-flex items-center gap-1.5 text-sm font-semibold text-deep-teal disabled:opacity-40"><Plus className="h-4 w-4" />Adicionar destino</button>
      </div>
      {!endpoints.length && <p className="text-sm text-stone">Nenhum destino configurado. Os eventos continuam sendo processados normalmente na Oria.</p>}
      {endpoints.map((endpoint, index) => <fieldset key={endpoint.id} disabled={Boolean(busy)} className="space-y-3 rounded-lg border border-mist p-4">
        <legend className="px-1 text-xs font-bold text-stone">Destino {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold text-slate-ink">Nome<input required maxLength={80} value={endpoint.name} onChange={event => update(endpoint.id, { name: event.target.value } as Partial<E>)} className="block w-full rounded-lg border border-mist p-2 font-normal" placeholder="Minha plataforma" /></label>
          <label className="space-y-1 text-sm font-semibold text-slate-ink">Novas tentativas (0–{FORWARDING_MAX_RETRIES})<input required type="number" min={0} max={FORWARDING_MAX_RETRIES} step={1} value={endpoint.maxRetries} onChange={event => update(endpoint.id, { maxRetries: Number(event.target.value) } as Partial<E>)} className="block w-full rounded-lg border border-mist p-2 font-normal" /></label>
        </div>
        <label className="block space-y-1 text-sm font-semibold text-slate-ink">URL de destino<input required type="url" maxLength={2048} value={endpoint.url} onChange={event => update(endpoint.id, { url: event.target.value } as Partial<E>)} className="block w-full rounded-lg border border-mist p-2 font-mono text-xs font-normal" placeholder="https://plataforma.example/webhook" /></label>
        {filters?.(endpoint, patch => update(endpoint.id, patch), settings)}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-ink"><input type="checkbox" checked={endpoint.enabled} onChange={event => update(endpoint.id, { enabled: event.target.checked } as Partial<E>)} />Encaminhamento ativo</label>
          <div className="flex items-center gap-3">
            <button type="button" disabled={dirty || Boolean(busy)} onClick={() => void perform("test", endpoint.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-deep-teal disabled:opacity-40">{busy === endpoint.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}Testar HTTP 200</button>
            <button type="button" aria-label={`Remover destino ${index + 1}`} onClick={() => setEndpoints(current => current.filter(item => item.id !== endpoint.id))} className="text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      </fieldset>)}
      <p className="text-xs leading-5 text-stone">HTTP 200 confirma a aceitação, não o processamento interno. Cada entrega faz uma tentativa inicial e até o limite de novas tentativas, com espera progressiva de 30 segundos até 1 hora. Salve antes de testar; o teste usa dados fictícios, funciona com o destino desativado e não faz novas tentativas. Uma entrega pendente é cancelada se o destino for removido, desativado, mudar de URL ou deixar de aceitar o evento.</p>
      <button type="submit" disabled={!dirty || Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy === "save" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{busy === "save" ? "Salvando..." : "Salvar destinos"}</button>
    </form>}
  </section>;
}

function StatsSummary({ stats }: { stats: ForwardingStats }) {
  const periods: Array<[string, ForwardingStats["last24Hours"]]> = [
    ["Últimas 24 horas", stats.last24Hours], ["Últimos 7 dias", stats.last7Days], ["Últimos 30 dias", stats.last30Days],
  ];
  return <div aria-label="Entregas" className="grid overflow-hidden rounded-lg border border-mist sm:grid-cols-3 sm:divide-x sm:divide-mist">
    {periods.map(([label, counts]) => <div key={label} className="border-b border-mist px-4 py-3 last:border-b-0 sm:border-b-0">
      <p className="text-xs font-semibold text-stone">{label}</p>
      <p className="mt-1 text-sm text-slate-ink"><strong className="text-base">{counts.delivered}</strong> enviados</p>
      <p className={`text-xs ${counts.failed > 0 ? "font-semibold text-red-700" : "text-stone"}`}>{counts.failed} com falha</p>
    </div>)}
  </div>;
}

function CalendarFilters({ endpoint, update, eventTypes }: {
  endpoint: CalendarForwardingEndpoint;
  update: (patch: Partial<CalendarForwardingEndpoint>) => void;
  eventTypes: Array<{ key: string; name: string }>;
}) {
  const toggle = <T extends string>(list: T[], value: T, order: readonly T[]) =>
    list.includes(value) ? list.filter(item => item !== value) : order.filter(item => item === value || list.includes(item));
  const allTypes = eventTypes.map(eventType => eventType.key);
  return <div className="grid gap-4 rounded-lg bg-cloud/40 p-3 lg:grid-cols-3">
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-bold uppercase text-stone">Quando enviar</legend>
      {CALENDAR_FORWARDING_TRIGGERS.map(trigger => <label key={trigger} className="flex items-center gap-2 text-sm text-slate-ink"><input type="checkbox" checked={endpoint.triggers.includes(trigger)} onChange={() => update({ triggers: toggle(endpoint.triggers, trigger, CALENDAR_FORWARDING_TRIGGERS) })} />{CALENDAR_TRIGGER_LABELS[trigger]}</label>)}
    </fieldset>
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-bold uppercase text-stone">Status de confirmação</legend>
      {CALENDAR_FORWARDING_STATUSES.map(status => <label key={status} className="flex items-center gap-2 text-sm text-slate-ink"><input type="checkbox" checked={endpoint.statuses.includes(status)} onChange={() => update({ statuses: toggle(endpoint.statuses, status, CALENDAR_FORWARDING_STATUSES) })} />{CALENDAR_STATUS_LABELS[status]}</label>)}
      <p className="pt-1 text-[11px] leading-4 text-stone">Status do evento depois da mudança (no cancelamento, o último status).</p>
    </fieldset>
    <fieldset className="space-y-1.5">
      <legend className="flex w-full items-center justify-between gap-2 text-xs font-bold uppercase text-stone">Tipos de evento
        <button type="button" onClick={() => update({ eventTypes: endpoint.eventTypes.length === allTypes.length ? [] : allTypes })} className="text-[11px] font-semibold normal-case text-deep-teal">{endpoint.eventTypes.length === allTypes.length ? "Limpar" : "Todos"}</button>
      </legend>
      {!eventTypes.length && <p className="text-sm text-stone">Cadastre tipos de evento na Agenda.</p>}
      <div className="max-h-40 space-y-1.5 overflow-y-auto">
        {eventTypes.map(eventType => <label key={eventType.key} className="flex items-center gap-2 text-sm text-slate-ink"><input type="checkbox" checked={endpoint.eventTypes.includes(eventType.key)} onChange={() => update({ eventTypes: toggle(endpoint.eventTypes, eventType.key, allTypes) })} />{eventType.name}</label>)}
      </div>
    </fieldset>
  </div>;
}
