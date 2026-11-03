"use client";

import { useState, useTransition } from "react";
import { Eraser, Search } from "lucide-react";
import { Badge, Card, buttonClass, dangerButtonClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { useGuardedAction } from "@/components/guarded-action";
import type { CleanupPreview, CleanupScope, CleanupTarget } from "@/lib/cleanup";
import { formatBytes, formatNumber } from "@/lib/format";
import { previewCleanupAction, runCleanupAction } from "../actions";

interface TargetInfo { key: string; label: string; collection: string; action: "compact" | "delete"; description: string }

export function CleanupClient({ companies, targets }: { companies: Array<{ id: string; name: string; status: string }>; targets: TargetInfo[] }) {
  // Empty selection = every clinic.
  const [selected, setSelected] = useState<string[]>([]);
  const [olderThanDays, setOlderThanDays] = useState(90);
  const [preview, setPreview] = useState<{ scope: CleanupScope; rows: CleanupPreview[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulating, startSimulation] = useTransition();
  const { run, pending, ui } = useGuardedAction();

  const scope: CleanupScope = { companyIds: selected, olderThanDays };
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const scopeLabel = (companyIds: string[]) => companyIds.length === 0
    ? "Todas as clínicas"
    : companyIds.map((id) => companies.find((company) => company.id === id)?.name ?? id).join(", ");
  const stale = preview && JSON.stringify(preview.scope) !== JSON.stringify(scope);

  function simulate(nextScope = scope) {
    setError(null);
    startSimulation(async () => {
      const result = await previewCleanupAction(nextScope);
      if (result.ok) setPreview({ scope: nextScope, rows: result.data });
      else { setPreview(null); setError(result.error); }
    });
  }

  function clean(target: TargetInfo) {
    if (!preview) return;
    const scopeAtPreview = preview.scope;
    run((confirmation) => runCleanupAction(target.key as CleanupTarget, scopeAtPreview, confirmation), {
      onSuccess: () => simulate(scopeAtPreview),
      success: target.action === "compact" ? "Execuções compactadas." : "Histórico excluído.",
    });
  }

  const total = preview?.rows.reduce((sum, row) => sum + row.estimatedBytes, 0) ?? 0;
  return (
    <div className="space-y-6">
      {ui}
      <Card title="1. Escolha o que limpar" description="A simulação só lê o banco; nada é alterado até você confirmar cada limpeza.">
        <fieldset className="mb-4">
          <legend className={labelClass}>Clínicas</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelected([])}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${selected.length === 0 ? "border-deep-teal bg-deep-teal text-white" : "border-mist bg-white text-slate-ink hover:border-deep-teal/40"}`}>
              Todas as clínicas
            </button>
            {companies.map((company) => {
              const checked = selected.includes(company.id);
              return (
                <label key={company.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${checked ? "border-deep-teal bg-deep-teal/10 text-slate-ink" : "border-mist bg-white text-slate-ink/80 hover:border-deep-teal/40"}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(company.id)} className="h-4 w-4 accent-deep-teal" />
                  {company.name}{company.status === "active" && <Badge tone="dark">produção</Badge>}
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-ink/55">{selected.length === 0 ? "Nenhuma marcada: a limpeza vale para todas as clínicas." : `${selected.length} clínica(s) marcada(s).`}</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-[180px_auto] sm:items-end sm:justify-start">
          <label className="block">
            <span className={labelClass}>Mais antigos que (dias)</span>
            <input type="number" min={7} max={3650} value={olderThanDays} onChange={(event) => setOlderThanDays(Number(event.target.value))} className={inputClass} />
          </label>
          <button type="button" onClick={() => simulate()} disabled={simulating || pending} className={buttonClass}>
            <Search className="h-4 w-4" />{simulating ? "Simulando..." : "Simular"}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      {preview && (
        <Card
          title="2. Resultado da simulação"
          description={`${scopeLabel(preview.scope.companyIds)} · mais antigos que ${preview.scope.olderThanDays} dias · até ${formatBytes(total)} liberados (estimativa, dados sem compressão)`}
        >
          {stale && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Você mudou a clínica ou a idade: simule de novo para limpar com os novos critérios.</p>}
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft-ivory text-left text-xs uppercase tracking-wide text-slate-ink/50">
                <tr><th className="px-5 py-2.5">Tipo</th><th className="px-3 text-right">Documentos</th><th className="px-3 text-right">Espaço (estimado)</th><th className="px-5 text-right">Ação</th></tr>
              </thead>
              <tbody className="divide-y divide-mist">
                {targets.map((target) => {
                  const row = preview.rows.find((item) => item.target === target.key);
                  const count = row?.count ?? 0;
                  return (
                    <tr key={target.key} className="align-top">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-ink">{target.label} <Badge tone={target.action === "compact" ? "teal" : "gray"}>{target.action === "compact" ? "compactar" : "excluir"}</Badge></p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-ink/50">{target.collection}</p>
                        <p className="mt-1 max-w-xl text-xs text-slate-ink/65">{target.description}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatNumber(count)}
                        {row?.relatedCount ? <span className="block text-[11px] text-slate-ink/50">+ {formatNumber(row.relatedCount)} passos</span> : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatBytes(row?.estimatedBytes ?? 0)}</td>
                      <td className="px-5 py-3 text-right">
                        <button type="button" disabled={count === 0 || pending || simulating || Boolean(stale)} onClick={() => clean(target)}
                          className={target.action === "compact" ? secondaryButtonClass : dangerButtonClass}>
                          <Eraser className="h-4 w-4" />{target.action === "compact" ? "Compactar" : "Excluir"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
