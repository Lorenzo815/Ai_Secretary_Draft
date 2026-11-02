"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { useGuardedAction } from "@/components/guarded-action";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { gatewayCreditsAction, replaceGatewayKeyAction } from "../actions";

const money = (value: number, currency: string) =>
  Number.isFinite(value) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value) : "—";

export function GatewayKeyPanel({ configured }: { configured: boolean }) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [credits, setCredits] = useState<{ balance: number; totalSpend: number; currency: string } | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState("");

  return (
    <div className="mt-4 space-y-4">
      {ui}
      {configured && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending} className={secondaryButtonClass}
            onClick={() => run(() => gatewayCreditsAction(), { success: "Saldo consultado na Vercel.", onSuccess: setCredits })}>
            <RefreshCw className="h-4 w-4" />Consultar saldo
          </button>
          {credits && (
            <p className="text-sm">
              Saldo <strong>{money(credits.balance, credits.currency)}</strong>
              <span className="text-slate-ink/55"> · gasto total {money(credits.totalSpend, credits.currency)}</span>
            </p>
          )}
        </div>
      )}
      {!replacing ? (
        <button type="button" onClick={() => setReplacing(true)} className={secondaryButtonClass}><KeyRound className="h-4 w-4" />{configured ? "Substituir chave" : "Configurar chave"}</button>
      ) : (
        <form className="rounded-xl border border-mist bg-soft-ivory/60 p-4" onSubmit={(event) => {
          event.preventDefault();
          run((confirmation) => replaceGatewayKeyAction(newKey, confirmation), {
            onSuccess: (result) => { setCredits(result); setNewKey(""); setReplacing(false); router.refresh(); },
          });
        }}>
          <label><span className={labelClass}>Nova AI Gateway API key (Vercel → AI Gateway → API Keys)</span>
            <input value={newKey} onChange={(event) => setNewKey(event.target.value)} type="password" autoComplete="off" placeholder="vck_..." required
              className={`${inputClass} mt-1 font-mono`} />
          </label>
          <p className="mt-2 text-xs text-slate-ink/55">A chave é testada na Vercel antes de ser salva, e gravada criptografada no mesmo formato da plataforma. Vale para todas as clínicas imediatamente.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setReplacing(false); setNewKey(""); }} className={secondaryButtonClass}>Cancelar</button>
            <button disabled={pending || !newKey} className={buttonClass}>Testar e salvar</button>
          </div>
        </form>
      )}
    </div>
  );
}
