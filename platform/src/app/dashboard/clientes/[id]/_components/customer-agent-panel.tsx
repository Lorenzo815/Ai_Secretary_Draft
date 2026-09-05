"use client";

import { useState } from "react";

type ServiceStatus = "ai_active" | "waiting_human" | "human_active" | "closed";

interface AgentRunView {
  id: string;
  status: "running" | "completed" | "failed" | "superseded";
  configRevision: number;
  modelIterations: number;
  toolExecutions: number;
  mutationsExecuted: number;
  finalDecision?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export default function CustomerAgentPanel({
  customerId,
  initialServiceStatus,
  runs,
  conversationState,
}: {
  customerId: string;
  initialServiceStatus: ServiceStatus;
  runs: AgentRunView[];
  conversationState: { summary: string; updatedAt: string } | null;
}) {
  const [serviceStatus, setServiceStatus] = useState(initialServiceStatus);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function changeStatus(status: ServiceStatus) {
    setSaving(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/customers/${customerId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json() as { status?: ServiceStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error ?? "Não foi possível alterar o status.");
      setServiceStatus(data.status);
      setFeedback("Status do atendimento atualizado.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    } finally {
      setSaving(false);
    }
  }

  return <section aria-labelledby="agent-title" className="space-y-6 border-y border-mist py-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase text-deep-teal">Automação</p><h2 id="agent-title" className="mt-1 font-heading text-base font-semibold text-slate-ink">Agente do cliente</h2></div>
      <div className="flex flex-wrap gap-2">{(["ai_active", "waiting_human", "human_active", "closed"] as const).map((status) => <button key={status} type="button" aria-pressed={serviceStatus === status} disabled={saving} onClick={() => void changeStatus(status)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${serviceStatus === status ? "border-deep-teal bg-deep-teal text-white" : "border-mist bg-white text-stone"}`}>{statusLabel(status)}</button>)}</div>
    </div>
    {feedback && <p className="text-sm text-deep-teal">{feedback}</p>}
    {conversationState && <div><p className="text-xs font-semibold uppercase text-stone">Memória operacional</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-ink">{conversationState.summary || "Sem resumo acumulado."}</p><p className="mt-1 text-xs text-stone">Atualizada em {formatDateTime(conversationState.updatedAt)}</p></div>}
    <div><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase text-stone">Execuções recentes</p><span className="text-xs text-stone">{runs.length}</span></div>
      {runs.length === 0 ? <p className="mt-3 text-sm text-stone">Nenhuma execução do agente registrada.</p> : <>
        <div className="mt-3 divide-y divide-mist border-y border-mist md:hidden">
          {runs.map((run) => <article key={run.id} className="py-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-ink">{runStatus(run.status)}</p><p className="mt-1 text-xs text-stone">{formatDateTime(run.startedAt)} · revisão {run.configRevision}</p></div><span className="rounded-md bg-soft-ivory px-2 py-1 text-[10px] font-semibold text-stone">{run.modelIterations} iterações</span></div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-stone">Ferramentas</dt><dd className="mt-0.5 font-semibold text-slate-ink">{run.toolExecutions}</dd></div><div><dt className="text-stone">Mutações</dt><dd className="mt-0.5 font-semibold text-slate-ink">{run.mutationsExecuted}</dd></div></dl>
            <p className="mt-3 text-xs leading-5 text-stone">{run.finalDecision ?? run.error ?? "Em processamento"}</p>
          </article>)}
        </div>
        <div className="mt-3 hidden overflow-x-auto md:block"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-b border-mist text-stone"><tr><th className="py-2 pr-4">Início</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Configuração</th><th className="py-2 pr-4">Modelo</th><th className="py-2 pr-4">Tools</th><th className="py-2 pr-4">Mutações</th><th className="py-2">Decisão</th></tr></thead><tbody className="divide-y divide-mist">{runs.map((run) => <tr key={run.id}><td className="py-3 pr-4 text-stone">{formatDateTime(run.startedAt)}</td><td className="py-3 pr-4 font-semibold text-slate-ink">{runStatus(run.status)}</td><td className="py-3 pr-4 text-stone">r{run.configRevision}</td><td className="py-3 pr-4 text-stone">{run.modelIterations}</td><td className="py-3 pr-4 text-stone">{run.toolExecutions}</td><td className="py-3 pr-4 text-stone">{run.mutationsExecuted}</td><td className="py-3 text-stone">{run.finalDecision ?? run.error ?? "Em processamento"}</td></tr>)}</tbody></table></div>
      </>}
    </div>
  </section>;
}

function statusLabel(status: ServiceStatus) { return status === "ai_active" ? "IA ativa" : status === "waiting_human" ? "Aguardando equipe" : status === "human_active" ? "Equipe ativa" : "Encerrado"; }
function runStatus(status: AgentRunView["status"]) { return status === "completed" ? "Concluída" : status === "failed" ? "Falhou" : status === "superseded" ? "Substituída" : "Executando"; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
