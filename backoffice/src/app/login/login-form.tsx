"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-6">
      <label className="relative block">
        <KeyRound className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-white/40" />
        <input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
          placeholder="000000" aria-label="Código do autenticador"
          className="h-12 w-full rounded-xl border border-white/15 bg-white/5 pl-11 pr-3 text-center font-mono text-2xl tracking-[0.5em] text-white outline-none placeholder:text-white/20 focus:border-soft-jade" />
      </label>
      {state?.error && (
        <p className="mt-3 rounded-lg border border-burnt-coral/40 bg-burnt-coral/10 px-3 py-2 text-sm text-burnt-coral">{state.error}</p>
      )}
      <button disabled={pending} className="mt-4 h-11 w-full rounded-xl bg-soft-jade text-sm font-semibold text-night transition hover:bg-white disabled:opacity-60">
        {pending ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
