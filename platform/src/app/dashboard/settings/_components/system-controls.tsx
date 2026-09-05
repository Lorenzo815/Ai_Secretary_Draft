"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CircleDollarSign, DatabaseZap } from "lucide-react";

export default function SystemControls({
  initialProcessingEnabled,
  initialPayment,
  initialCustomers,
}: {
  initialProcessingEnabled: boolean;
  initialPayment: { configured: boolean; recipientName: string; signalAmountCents: number };
  initialCustomers: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const initialSignalAmount = (initialPayment.signalAmountCents / 100).toFixed(2);
  const [processingEnabled, setProcessingEnabled] = useState(initialProcessingEnabled);
  const [deletionScope, setDeletionScope] = useState<"customer" | "all">("customer");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pixKey, setPixKey] = useState("");
  const [recipientName, setRecipientName] = useState(initialPayment.recipientName);
  const [signalAmount, setSignalAmount] = useState(initialSignalAmount);
  const [paymentBaseline, setPaymentBaseline] = useState({
    recipientName: initialPayment.recipientName,
    signalAmount: initialSignalAmount,
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const confirmationAccepted = confirmation.trim() === "APAGAR";
  const deletionTargetSelected = deletionScope === "all" || Boolean(selectedCustomerId);
  const deletionEnabled = confirmationAccepted && deletionTargetSelected && !processingEnabled && !deleting;
  const paymentDirty = Boolean(
    pixKey
    || recipientName !== paymentBaseline.recipientName
    || signalAmount !== paymentBaseline.signalAmount,
  );
  const refreshBlocked = paymentDirty || Boolean(confirmation) || saving || savingPayment || deleting;

  useEffect(() => {
    setProcessingEnabled(initialProcessingEnabled);
  }, [initialProcessingEnabled]);

  useEffect(() => {
    if (paymentDirty || savingPayment) return;
    setRecipientName(initialPayment.recipientName);
    setSignalAmount(initialSignalAmount);
    setPaymentBaseline({
      recipientName: initialPayment.recipientName,
      signalAmount: initialSignalAmount,
    });
  }, [initialPayment.recipientName, initialSignalAmount, paymentDirty, savingPayment]);

  async function toggleProcessing() {
    setSaving(true);
    setMessage(null);
    try {
      const nextValue = !processingEnabled;
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processingEnabled: nextValue }),
      });
      const result = await response.json() as { processingEnabled?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar o processamento.");
      const savedValue = result.processingEnabled ?? nextValue;
      setProcessingEnabled(savedValue);
      setMessage(savedValue
        ? "Processamento de respostas retomado."
        : "Processamento pausado. Novos jobs continuarão sendo salvos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o processamento.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDynamicData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: confirmation.trim(),
          scope: deletionScope,
          ...(deletionScope === "customer" ? { customerId: selectedCustomerId } : {}),
        }),
      });
      const result = await response.json() as { deletedCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível apagar os dados.");
      setConfirmation("");
      setSelectedCustomerId("");
      setMessage(deletionScope === "customer"
        ? `${result.deletedCount ?? 0} registros do cliente foram apagados.`
        : `${result.deletedCount ?? 0} registros dinâmicos foram apagados.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível apagar os dados.");
    } finally {
      setDeleting(false);
    }
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPayment(true);
    setMessage(null);
    try {
      const amountCents = Math.round(Number(signalAmount.replace(",", ".")) * 100);
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment: { pixKey, recipientName, signalAmountCents: amountCents },
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o Pix.");
      setPixKey("");
      const normalizedAmount = (amountCents / 100).toFixed(2);
      setSignalAmount(normalizedAmount);
      setPaymentBaseline({ recipientName, signalAmount: normalizedAmount });
      setMessage("Configuração do sinal via Pix atualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o Pix.");
    } finally {
      setSavingPayment(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2" data-auto-refresh-dirty={refreshBlocked ? "true" : undefined}>
      <section aria-labelledby="assistant-processing-title" className="rounded-lg border border-mist bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><Bot className="h-5 w-5" /></span>
            <div>
              <h3 id="assistant-processing-title" className="font-heading text-base font-semibold text-slate-ink">Respostas automáticas</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-stone">Pause o processamento sem interromper o recebimento de novas mensagens.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={processingEnabled}
            aria-label="Processamento de respostas automáticas"
            disabled={saving}
            onClick={toggleProcessing}
            className="flex min-h-10 items-center gap-2.5 self-start rounded-md border border-mist bg-white px-3 transition-colors hover:border-stone disabled:cursor-wait disabled:opacity-60 sm:self-auto"
          >
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${processingEnabled ? "bg-deep-teal" : "bg-mist"}`}>
              <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${processingEnabled ? "translate-x-4" : "translate-x-0"}`} />
            </span>
            <span className="w-16 text-left text-sm font-semibold text-slate-ink">{saving ? "Salvando..." : processingEnabled ? "Ativo" : "Pausado"}</span>
          </button>
        </div>
        <div className={`mt-5 rounded-md px-3 py-2.5 text-xs font-medium ${processingEnabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{processingEnabled ? "A Oria está processando a fila normalmente." : "As mensagens continuam salvas, mas aguardam processamento."}</div>
      </section>

      <section aria-labelledby="payment-settings-title" className="rounded-lg border border-mist bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><CircleDollarSign className="h-5 w-5" /></span><div><h3 id="payment-settings-title" className="font-heading text-base font-semibold text-slate-ink">Sinal via Pix</h3><p className="mt-1 text-sm leading-6 text-stone">Fonte autorizada para valores informados pela IA.</p></div></div>
        <form onSubmit={savePayment} className="mt-4 grid gap-3 md:grid-cols-3 md:items-end">
          <label className="text-xs font-semibold text-slate-ink">
            Chave Pix
            <input value={pixKey} onChange={(event) => setPixKey(event.target.value)} required={!initialPayment.configured} placeholder={initialPayment.configured ? "Deixe vazio para manter a chave atual" : "Informe a chave Pix"} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Favorecido
            <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} required placeholder="Nome exibido no comprovante" className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Valor do sinal (R$)
            <input value={signalAmount} onChange={(event) => setSignalAmount(event.target.value)} required inputMode="decimal" className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <button type="submit" disabled={savingPayment || !paymentDirty} className="min-h-10 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50 md:col-start-3">
            {savingPayment ? "Salvando..." : "Salvar configuração Pix"}
          </button>
        </form>
      </section>

      <section aria-labelledby="database-title" className="rounded-lg border border-red-200 bg-white p-5 shadow-sm lg:col-span-2 sm:p-6">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700"><DatabaseZap className="h-5 w-5" /></span><div><p className="text-[11px] font-bold uppercase text-red-700">Zona de risco</p><h3 id="database-title" className="mt-0.5 font-heading text-base font-semibold text-slate-ink">Apagar dados dinâmicos</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-stone">Remove clientes, mensagens, agendamentos, jobs e históricos operacionais. Usuários, calendário e configurações ativas do agente serão preservados.</p></div></div>
        <form onSubmit={deleteDynamicData} className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <fieldset>
            <legend className="text-xs font-semibold text-slate-ink">O que deseja apagar?</legend>
            <div className="mt-1.5 grid grid-cols-2 overflow-hidden rounded-md border border-mist bg-white p-1">
              {([
                ["customer", "Um cliente"],
                ["all", "Todos os dados"],
              ] as const).map(([value, label]) => (
                <label key={value} className={`flex min-h-9 cursor-pointer items-center justify-center rounded px-3 text-sm font-semibold transition-colors ${deletionScope === value ? "bg-slate-ink text-white" : "text-stone hover:bg-pearl"}`}>
                  <input type="radio" name="deletionScope" value={value} checked={deletionScope === value} onChange={() => { setDeletionScope(value); setConfirmation(""); }} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {deletionScope === "customer" && (
            <label className="block text-xs font-semibold text-slate-ink">
              Cliente
              <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} required className="mt-1 block min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-red-500">
                <option value="">Selecione um cliente</option>
                {initialCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select>
            </label>
          )}
          <label className="block text-xs font-semibold text-slate-ink">
            Digite APAGAR para confirmar
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="APAGAR"
              aria-describedby="delete-confirmation-status"
              className={`mt-1 block min-h-10 w-full rounded-md border bg-white px-3 text-sm font-semibold tracking-wide outline-none transition-colors ${confirmationAccepted ? "border-red-600" : "border-mist focus:border-red-500"}`}
            />
          </label>
          <button
            type="submit"
            disabled={!deletionEnabled}
            className="flex min-h-10 w-full items-center justify-center rounded-md border border-red-700 bg-red-700 px-4 text-sm font-bold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:border-red-200 disabled:bg-white disabled:text-red-400"
          >
            {deleting ? "Apagando..." : "Confirmar exclusão"}
          </button>
        </form>
        <p id="delete-confirmation-status" className={`mt-3 text-xs font-medium lg:col-span-2 ${confirmationAccepted && !processingEnabled ? "text-red-700" : "text-stone"}`}>
          {processingEnabled
            ? "Pause as respostas automáticas antes de apagar."
            : !deletionTargetSelected
              ? "Selecione o cliente cujos dados serão apagados."
            : confirmationAccepted
              ? "Confirmação reconhecida. O botão de exclusão está liberado."
              : "O botão será liberado quando você digitar APAGAR."}
        </p>
      </section>

      {message && <p role="status" className="rounded-md border border-deep-teal/20 bg-deep-teal/5 px-4 py-3 text-sm font-medium text-deep-teal lg:col-span-2">{message}</p>}
    </div>
  );
}