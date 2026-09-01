"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface FlowOption {
  key: string;
  name: string;
  currentVersion: number;
}

interface AssignmentView {
  flowKey: string;
  flowVersion: number;
  status: "active" | "completed";
  stage: string;
  missingData: string[];
  startedAt: string;
  completionReason?: string;
}

interface HistoryView {
  id: string;
  flowKey: string;
  flowVersion: number;
  completedAt: string;
  completionReason: string;
  completionCode: string;
  nextFlowKey?: string;
  source: "assistant" | "manual";
}

interface ConversationStateView {
  summary: string;
  summarizedThrough: string;
  updatedAt: string;
}

type ServiceStatus = "ai_active" | "waiting_human" | "human_active" | "closed";

const statusLabels: Record<ServiceStatus, string> = {
  ai_active: "IA disponível",
  waiting_human: "Aguardando humano",
  human_active: "Atendimento humano",
  closed: "Atendimento encerrado",
};

const ownerLabels: Record<ServiceStatus, string> = {
  ai_active: "IA",
  waiting_human: "Equipe",
  human_active: "Equipe",
  closed: "Nenhum",
};

export default function CustomerFlowPanel({
  customerId,
  flows,
  assignment,
  history,
  initialServiceStatus,
  conversationState,
}: {
  customerId: string;
  flows: FlowOption[];
  assignment: AssignmentView;
  history: HistoryView[];
  initialServiceStatus: ServiceStatus;
  conversationState: ConversationStateView | null;
}) {
  const router = useRouter();
  const [flowKey, setFlowKey] = useState(assignment.flowKey);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [serviceStatus, setServiceStatus] = useState(initialServiceStatus);
  const names = new Map(flows.map((flow) => [flow.key, flow.name]));

  async function assignFlow() {
    setSaving(true);
    setFeedback("");
    const response = await fetch(`/api/assistant/customers/${customerId}/flow`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowKey, reason }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setFeedback(data.error ?? "Não foi possível alterar o fluxo.");
    } else {
      setReason("");
      setFeedback("Fluxo atribuído e alteração registrada no histórico.");
      router.refresh();
    }
    setSaving(false);
  }

  async function changeStatus(status: ServiceStatus) {
    setSaving(true);
    setFeedback("");
    const response = await fetch(`/api/customers/${customerId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = (await response.json()) as { status?: ServiceStatus; error?: string };
    if (response.ok && data.status) {
      setServiceStatus(data.status);
      setFeedback("Status do atendimento atualizado.");
    } else {
      setFeedback(data.error ?? "Não foi possível alterar o status.");
    }
    setSaving(false);
  }

  return (
    <section aria-labelledby="customer-flow-title" className="rounded-lg border border-mist bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-deep-teal">Fluxo atual</p>
          <h2 id="customer-flow-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">
            {names.get(assignment.flowKey) ?? assignment.flowKey}
          </h2>
          <p className="mt-1 text-xs text-stone">
            Versão {assignment.flowVersion} · {assignment.status === "active" ? "em andamento" : "concluído"} · etapa {assignment.stage}
          </p>
        </div>
        <div className="space-y-2 text-right">
          <p className="text-xs text-stone">Responsável: <span className="font-semibold text-slate-ink">{ownerLabels[serviceStatus]}</span></p>
          <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${serviceStatus === "waiting_human" ? "bg-burnt-coral/10 text-burnt-coral" : serviceStatus === "human_active" ? "bg-slate-ink/10 text-slate-ink" : serviceStatus === "closed" ? "bg-stone/10 text-stone" : "bg-deep-teal/10 text-deep-teal"}`}>
            {statusLabels[serviceStatus]}
          </span>
          {assignment.missingData.length > 0 && (
            <p className="max-w-sm text-xs text-stone">Pendências: {assignment.missingData.join(", ")}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-mist pt-4">
        <span className="mr-1 text-xs font-semibold text-stone">Situação do atendimento:</span>
        {(Object.keys(statusLabels) as ServiceStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => changeStatus(status)}
            disabled={saving || status === serviceStatus}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${status === serviceStatus ? "border-deep-teal bg-deep-teal text-white" : "border-mist bg-white text-slate-ink hover:border-deep-teal/40"}`}
          >
            {statusLabels[status]}
          </button>
        ))}
      </div>

      <div className="mt-5 border-l-2 border-deep-teal bg-soft-ivory px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-ink">Resumo para triagem</h3>
          {conversationState && (
            <p className="text-xs text-stone">Atualizado em {formatDateTime(conversationState.updatedAt)}</p>
          )}
        </div>
        {conversationState ? (
          <>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-ink/80">
              {conversationState.summary}
            </p>
            <p className="mt-2 text-xs text-stone">
              Resumo contempla mensagens até {formatDateTime(conversationState.summarizedThrough)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-stone">Ainda não há resumo gerado para este atendimento.</p>
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1.3fr)_auto] md:items-end">
        <label className="text-xs font-semibold text-slate-ink">
          Atribuir outro fluxo
          <select
            value={flowKey}
            onChange={(event) => setFlowKey(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal"
          >
            {flows.map((flow) => (
              <option key={flow.key} value={flow.key}>{flow.name} · v{flow.currentVersion}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-ink">
          Motivo obrigatório
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: solicitação confirmada pela recepção"
            className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal"
          />
        </label>
        <button
          type="button"
          onClick={assignFlow}
          disabled={saving || !reason.trim()}
          className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-40"
        >
          {saving ? "Atribuindo..." : "Atribuir"}
        </button>
      </div>
      <p className={`mt-2 text-xs ${feedback.startsWith("Fluxo") ? "text-deep-teal" : "text-burnt-coral"}`} aria-live="polite">
        {feedback}
      </p>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-ink">Histórico de fluxos</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-stone">Nenhum fluxo concluído ou transferido.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="border-b border-mist uppercase text-stone">
                <tr>
                  <th className="py-2 pr-4">Fluxo</th>
                  <th className="py-2 pr-4">Conclusão</th>
                  <th className="py-2 pr-4">Motivo</th>
                  <th className="py-2">Próximo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                {history.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 pr-4 font-semibold text-slate-ink">{names.get(item.flowKey) ?? item.flowKey} · v{item.flowVersion}</td>
                    <td className="py-3 pr-4 text-stone">{formatDateTime(item.completedAt)} · {item.source === "assistant" ? "IA" : "manual"}</td>
                    <td className="py-3 pr-4 text-slate-ink/75">{item.completionReason}</td>
                    <td className="py-3 text-slate-ink/75">{getNextStep(item, names)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function getNextStep(item: HistoryView, names: Map<string, string>) {
  if (item.nextFlowKey) return names.get(item.nextFlowKey) ?? item.nextFlowKey;
  if (item.completionCode === "appointment_confirmed") return names.get("schedule_appointment") ?? "Agendamento";
  if (item.completionCode === "appointment_booked") return "Agendamento concluído";
  return "Fluxo finalizado";
}