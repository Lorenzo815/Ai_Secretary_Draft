"use client";

import { Bot, Check, CircleStop, Clock3, LoaderCircle, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ServiceStatus = "ai_active" | "waiting_human" | "human_active" | "closed";

const STATUS_OPTIONS = [
  {
    value: "ai_active",
    label: "IA ativa",
    owner: "IA",
    description: "A IA responde novas mensagens e executa as automações do atendimento.",
    icon: Bot,
  },
  {
    value: "waiting_human",
    label: "Aguardando equipe",
    owner: "Equipe",
    description: "A IA fica pausada e o atendimento entra na fila para a equipe assumir.",
    icon: Clock3,
  },
  {
    value: "human_active",
    label: "Equipe ativa",
    owner: "Equipe",
    description: "A equipe conduz a conversa e a IA permanece pausada.",
    icon: UsersRound,
  },
  {
    value: "closed",
    label: "Encerrado",
    owner: "Sem responsável",
    description: "O atendimento é encerrado; novas mensagens ficam sinalizadas para revisão.",
    icon: CircleStop,
  },
] as const;

export default function CustomerServiceStatusControl({
  customerId,
  initialStatus,
  variant = "panel",
}: {
  customerId: string;
  initialStatus: ServiceStatus;
  variant?: "panel" | "compact";
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const current = STATUS_OPTIONS.find((option) => option.value === status)!;

  async function changeStatus(nextStatus: ServiceStatus) {
    if (saving || nextStatus === status) return;
    setSaving(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/customers/${customerId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json() as { status?: ServiceStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error ?? "Não foi possível alterar o responsável.");
      const selected = STATUS_OPTIONS.find((option) => option.value === data.status)!;
      setStatus(data.status);
      setFeedback(`Responsável alterado para ${selected.owner}. ${selected.description}`);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível alterar o responsável.");
    } finally {
      setSaving(false);
    }
  }

  if (variant === "compact") {
    return (
      <div className="min-w-[180px]" onClick={(event) => event.stopPropagation()}>
        <label className="text-[11px] font-semibold uppercase text-stone">
          Responsável pelo atendimento
          <span className="relative mt-1 block">
            <select
              aria-label="Responsável pelo atendimento"
              value={status}
              disabled={saving}
              onChange={(event) => void changeStatus(event.target.value as ServiceStatus)}
              className="w-full appearance-none rounded-md border border-mist bg-white px-2.5 py-2 pr-8 text-xs font-semibold text-slate-ink outline-none transition focus:border-deep-teal disabled:opacity-60"
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {saving && <LoaderCircle className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-deep-teal" />}
          </span>
        </label>
        {feedback && <p role="status" aria-live="polite" className="mt-1.5 max-w-56 text-[11px] leading-4 text-deep-teal">{feedback}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase text-stone">Responsável pelo atendimento</p>
        <p className="mt-1 text-sm leading-5 text-stone">Ao selecionar um estado, você muda imediatamente quem responde o cliente e se a IA pode continuar executando automações.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STATUS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = status === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={saving}
              onClick={() => void changeStatus(option.value)}
              className={`relative min-h-32 rounded-md border p-3 text-left transition disabled:cursor-wait disabled:opacity-70 ${selected ? "border-deep-teal bg-deep-teal/[0.06]" : "border-mist bg-white hover:border-deep-teal/45"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className={`h-4 w-4 ${selected ? "text-deep-teal" : "text-stone"}`} />
                {selected && <Check className="h-4 w-4 text-deep-teal" />}
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-ink">{option.label}</p>
              <p className="mt-1 text-[11px] font-semibold text-deep-teal">Responsável: {option.owner}</p>
              <p className="mt-1.5 text-[11px] leading-4 text-stone">{option.description}</p>
            </button>
          );
        })}
      </div>
      <div className="min-h-6" aria-live="polite">
        {saving ? <p className="flex items-center gap-2 text-sm text-stone"><LoaderCircle className="h-4 w-4 animate-spin" />Alterando responsável…</p> : feedback ? <p role="status" className="flex items-start gap-2 text-sm leading-5 text-deep-teal"><Check className="mt-0.5 h-4 w-4 shrink-0" />{feedback}</p> : <p className="text-sm text-stone">Estado atual: <strong className="text-slate-ink">{current.label}</strong> · responsável: {current.owner}.</p>}
      </div>
    </div>
  );
}