"use client";

import { useActionState } from "react";
import { checkSetupCodeAction } from "../login/actions";

export function SetupCheck() {
  const [state, action, pending] = useActionState(checkSetupCodeAction, null);
  return (
    <form action={action} className="mt-5 flex gap-2">
      <input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="000000" aria-label="Código de teste"
        className="h-11 flex-1 rounded-xl border border-white/15 bg-white/5 text-center font-mono text-xl tracking-[0.4em] text-white outline-none focus:border-soft-jade" />
      <button disabled={pending} className="h-11 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/10">Testar</button>
      {state && <p className={`basis-full text-sm ${state.ok ? "text-soft-jade" : "text-burnt-coral"}`}>{state.message}</p>}
    </form>
  );
}
