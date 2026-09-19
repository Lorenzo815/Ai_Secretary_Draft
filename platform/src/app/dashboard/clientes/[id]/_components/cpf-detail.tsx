"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export default function CpfDetail({
  customerId,
  maskedCpf,
}: {
  customerId: string;
  maskedCpf: string | null;
}) {
  const [cpf, setCpf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function reveal() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/customers/${customerId}/cpf`, {
        cache: "no-store",
      });
      const result = await response.json() as { cpf?: string; error?: string };
      if (!response.ok || !result.cpf) {
        setError(result.error ?? "Não foi possível exibir o CPF.");
        return;
      }
      setCpf(result.cpf);
    } catch {
      setError("Não foi possível conectar para exibir o CPF.");
    } finally {
      setLoading(false);
    }
  }

  function hide() {
    setCpf(null);
    setError("");
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase text-stone">CPF</p>
      <div className="mt-1 flex min-h-6 flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-ink">
          {cpf ?? maskedCpf ?? "Pendente"}
        </p>
        {maskedCpf && (
          <button
            type="button"
            disabled={loading}
            onClick={cpf ? hide : reveal}
            className="inline-flex items-center gap-1 text-xs font-semibold text-deep-teal transition hover:text-forest-teal disabled:cursor-wait disabled:opacity-50"
            aria-label={cpf ? "Ocultar CPF" : "Mostrar CPF completo"}
          >
            {cpf ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {cpf ? "Ocultar" : loading ? "Carregando..." : "Mostrar"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-burnt-coral">{error}</p>}
    </div>
  );
}
