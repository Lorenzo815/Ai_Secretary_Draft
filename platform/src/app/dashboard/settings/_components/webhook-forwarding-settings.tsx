"use client";

import { useEffect, useState } from "react";
import { FlaskConical, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  FORWARDING_DEFAULT_RETRIES, FORWARDING_ENDPOINT_LIMIT, FORWARDING_MAX_RETRIES,
  type ForwardingDeliveryStatus, type ForwardingEndpoint, type ForwardingResult, type ForwardingSettings,
} from "@/lib/whatsapp/forwarding-contracts";

interface ApiResult {
  settings?: ForwardingSettings;
  result?: ForwardingResult | null;
  error?: string;
}

const API = "/api/company/webhook-forwarding";
const STATUS: Record<ForwardingDeliveryStatus, string> = {
  pending: "Na fila", processing: "Enviando", delivered: "HTTP 200 recebido", failed: "Falhou", cancelled: "Cancelado",
};

export default function WebhookForwardingSettings({ companyName }: { companyName: string }) {
  const [settings, setSettings] = useState<ForwardingSettings | null>(null);
  const [endpoints, setEndpoints] = useState<ForwardingEndpoint[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [busy, setBusy] = useState<string | null>("load");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(endpoints) !== baseline;

  function apply(next: ForwardingSettings) {
    setSettings(next);
    setEndpoints(next.endpoints);
    setBaseline(JSON.stringify(next.endpoints));
  }

  useEffect(() => {
    let active = true;
    fetch(API, { cache: "no-store" }).then(async response => {
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.settings) throw new Error(result.error ?? "Não foi possível carregar os encaminhamentos.");
      if (active) apply(result.settings);
    }).catch(error => {
      if (active) setMessage({ error: true, text: error instanceof Error ? error.message : "Falha ao carregar os encaminhamentos." });
    }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, []);

  function update(id: string, patch: Partial<ForwardingEndpoint>) {
    setEndpoints(current => current.map(endpoint => endpoint.id === id ? { ...endpoint, ...patch } : endpoint));
    setMessage(null);
  }

  async function perform(action: "save" | "refresh" | "test", endpointId?: string) {
    setBusy(endpointId ?? action);
    setMessage(null);
    try {
      const response = await fetch(API, action === "refresh" ? { cache: "no-store" } : {
        method: action === "save" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save" ? { revision: settings?.revision, endpoints } : { endpointId }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.settings) throw new Error(result.error ?? "Não foi possível concluir a operação.");
      apply(result.settings);
      if (action === "test") {
        setMessage({
          error: !result.result?.ok,
          text: result.result?.ok
            ? `Teste aceito: HTTP 200 em ${result.result.durationMs} ms. Confirme o processamento na plataforma de destino.`
            : result.result?.error ?? "O teste foi cancelado porque o destino ou a empresa mudou.",
        });
      } else if (action === "save") setMessage({ error: false, text: "Encaminhamentos da empresa salvos." });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Falha ao atualizar os encaminhamentos." });
    } finally { setBusy(null); }
  }

  return <section aria-label="Encaminhamento de webhooks" data-auto-refresh-dirty={dirty ? "true" : undefined} className="space-y-5 rounded-lg border border-mist bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-heading text-lg font-semibold text-slate-ink">Encaminhamento do WhatsApp</h2>
        <p className="mt-1 text-sm text-stone">Destinos exclusivos de {companyName}. Apenas o administrador pode configurar e testar.</p>
      </div>
      <button type="button" disabled={Boolean(busy) || dirty} onClick={() => void perform("refresh")} className="inline-flex items-center gap-2 rounded-lg border border-mist px-3 py-2 text-sm font-semibold text-deep-teal disabled:opacity-50"><RefreshCw className="h-4 w-4" />Atualizar status</button>
    </div>
    <div className="rounded-lg bg-warm-sand/50 p-3 text-sm leading-6 text-stone">
      <p>Todos os payloads POST válidos da Meta são enviados sem alteração, inclusive mensagens, mídias e status. A verificação GET e o cron não são encaminhados.</p>
      <p>Ao ativar um destino, você autoriza o envio dos dados pessoais presentes nesses eventos. Use apenas plataformas confiáveis com HTTPS público na porta 443.</p>
      <p>HTTP 200 confirma a aceitação, não o processamento interno. Os testes usam um objeto sintético sem mensagens de clientes e não fazem novas tentativas.</p>
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${message.error ? "bg-red-50 text-red-700" : "bg-deep-teal/10 text-deep-teal"}`}>{message.text}</p>}
    {!settings && busy && <p className="flex items-center gap-2 text-sm text-stone"><LoaderCircle className="h-4 w-4 animate-spin" />Carregando encaminhamentos...</p>}
    {settings && <form onSubmit={event => { event.preventDefault(); void perform("save"); }} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-ink">Destinos · {endpoints.length}/{FORWARDING_ENDPOINT_LIMIT}</p>
        <button type="button" disabled={Boolean(busy) || endpoints.length >= FORWARDING_ENDPOINT_LIMIT} onClick={() => setEndpoints(current => [...current, { id: crypto.randomUUID(), name: "", url: "", enabled: false, maxRetries: FORWARDING_DEFAULT_RETRIES }])} className="inline-flex items-center gap-1.5 text-sm font-semibold text-deep-teal disabled:opacity-40"><Plus className="h-4 w-4" />Adicionar destino</button>
      </div>
      {!endpoints.length && <p className="text-sm text-stone">Nenhum destino configurado. Os eventos continuam sendo processados normalmente na Oria.</p>}
      {endpoints.map((endpoint, index) => <fieldset key={endpoint.id} disabled={Boolean(busy)} className="space-y-3 rounded-lg border border-mist p-4">
        <legend className="px-1 text-xs font-bold text-stone">Destino {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold text-slate-ink">Nome<input required maxLength={80} value={endpoint.name} onChange={event => update(endpoint.id, { name: event.target.value })} className="block w-full rounded-lg border border-mist p-2 font-normal" placeholder="Minha plataforma" /></label>
          <label className="space-y-1 text-sm font-semibold text-slate-ink">Novas tentativas (0–{FORWARDING_MAX_RETRIES})<input required type="number" min={0} max={FORWARDING_MAX_RETRIES} step={1} value={endpoint.maxRetries} onChange={event => update(endpoint.id, { maxRetries: Number(event.target.value) })} className="block w-full rounded-lg border border-mist p-2 font-normal" /></label>
        </div>
        <label className="block space-y-1 text-sm font-semibold text-slate-ink">URL de destino<input required type="url" maxLength={2048} value={endpoint.url} onChange={event => update(endpoint.id, { url: event.target.value })} className="block w-full rounded-lg border border-mist p-2 font-mono text-xs font-normal" placeholder="https://plataforma.example/webhook" /></label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-ink"><input type="checkbox" checked={endpoint.enabled} onChange={event => update(endpoint.id, { enabled: event.target.checked })} />Encaminhamento ativo</label>
          <div className="flex items-center gap-3">
            <button type="button" disabled={dirty || Boolean(busy)} onClick={() => void perform("test", endpoint.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-deep-teal disabled:opacity-40">{busy === endpoint.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}Testar HTTP 200</button>
            <button type="button" aria-label={`Remover destino ${index + 1}`} onClick={() => setEndpoints(current => current.filter(item => item.id !== endpoint.id))} className="text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      </fieldset>)}
      <p className="text-xs leading-5 text-stone">Cada entrega faz uma tentativa inicial e até o limite configurado de novas tentativas, com espera progressiva de 30 segundos até 1 hora. O limite salvo vale para novas entregas. Salve antes de testar; o teste funciona mesmo com o destino desativado. Remover, desativar ou alterar a URL cancela entregas antigas ainda não iniciadas.</p>
      <button type="submit" disabled={!dirty || Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy === "save" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{busy === "save" ? "Salvando..." : "Salvar encaminhamentos"}</button>
    </form>}
    {settings && <div className="space-y-3 border-t border-mist pt-4">
      <h3 className="text-sm font-bold text-slate-ink">Últimas 25 entregas e testes</h3>
      {!settings.deliveries.length ? <p className="text-sm text-stone">Nenhuma entrega registrada.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead className="text-stone"><tr><th className="p-2">Destino</th><th className="p-2">Resultado</th><th className="p-2">Tentativas</th><th className="p-2">Detalhes</th></tr></thead>
        <tbody>{settings.deliveries.map(delivery => <tr key={delivery.id} className="border-t border-mist align-top">
          <td className="p-2 font-semibold text-slate-ink">{delivery.endpointName}{delivery.isTest && <span className="ml-1 text-stone">(teste)</span>}<p className="mt-1 font-normal text-stone">{new Date(delivery.createdAt).toLocaleString("pt-BR")}</p></td>
          <td className="p-2">{STATUS[delivery.status]}{delivery.lastStatus !== null && delivery.status !== "delivered" && <p>HTTP {delivery.lastStatus}</p>}</td>
          <td className="p-2">{delivery.attempts}/{delivery.maxRetries + 1}</td>
          <td className="max-w-sm p-2 text-stone">{delivery.lastError}{delivery.nextAttemptAt && <p>Próxima: {new Date(delivery.nextAttemptAt).toLocaleString("pt-BR")}</p>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>}
  </section>;
}
