"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { inputClass } from "./ui";

type Action<T> = (confirmation?: string) => Promise<ActionResult<T>>;

interface Prompt {
  phrase: string;
  message: string;
  retry: (confirmation: string) => Promise<void>;
}

/**
 * Runs a server action; when the server asks for a typed confirmation (risky write),
 * shows a dialog and re-runs the action with what was typed.
 */
export function useGuardedAction() {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  useEffect(() => {
    if (!notice?.ok) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function run<T>(action: Action<T>, options: { success?: string; onSuccess?: (data: T) => void } = {}) {
    const handle = (result: ActionResult<T>) => {
      if (result.ok) {
        setNotice({ ok: true, text: options.success ?? result.message ?? "Alteração salva." });
        options.onSuccess?.(result.data);
      } else if (result.confirm) {
        setPrompt({
          phrase: result.confirm, message: result.error,
          retry: async (confirmation) => handle(await action(confirmation)),
        });
      } else {
        setNotice({ ok: false, text: result.error });
      }
    };
    setNotice(null);
    startTransition(async () => handle(await action(undefined)));
  }

  const ui: ReactNode = (
    <>
      {prompt && (
        <ConfirmDialog prompt={prompt} onClose={() => setPrompt(null)}
          onConfirm={(typed) => { const current = prompt; setPrompt(null); startTransition(() => current.retry(typed)); }} />
      )}
      {notice && (
        <div role="status" className={`fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${notice.ok ? "bg-night text-white" : "bg-red-600 text-white"}`}>
          {notice.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-soft-jade" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="whitespace-pre-line">{notice.text}</span>
          <button type="button" aria-label="Fechar" onClick={() => setNotice(null)} className="ml-2 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}
    </>
  );
  return { run, pending, ui };
}

function ConfirmDialog({ prompt, onClose, onConfirm }: { prompt: Prompt; onClose: () => void; onConfirm: (typed: string) => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <form className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onSubmit={(event) => { event.preventDefault(); if (typed.trim() === prompt.phrase) onConfirm(typed.trim()); }}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle className="h-5 w-5" /></span>
          <h2 className="font-heading text-lg font-semibold text-slate-ink">Confirme esta alteração</h2>
        </div>
        <p className="mt-3 text-sm text-slate-ink/75">{prompt.message}</p>
        <p className="mt-4 text-sm text-slate-ink/75">Digite <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono font-semibold text-slate-ink">{prompt.phrase}</code> para continuar:</p>
        <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} className={`${inputClass} mt-2 font-mono`} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-mist px-4 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Cancelar</button>
          <button type="submit" disabled={typed.trim() !== prompt.phrase}
            className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">Confirmar</button>
        </div>
      </form>
    </div>
  );
}
