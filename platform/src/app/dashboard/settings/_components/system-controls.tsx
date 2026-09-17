"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, CircleAlert, CircleDollarSign, DatabaseZap, KeyRound, LoaderCircle, RefreshCw, Save, Trash2 } from "lucide-react";

type PaymentProvider = "manual" | "mercado_pago";
interface MercadoPagoStatus {
  configured: boolean;
  source: "environment" | "database" | null;
  environmentConfigured: boolean;
  databaseConfigured: boolean;
  storageEncryptionConfigured: boolean;
}

export default function SystemControls({
  initialProcessingEnabled,
  initialPayment,
  initialPaymentProvider,
  initialCustomers,
}: {
  initialProcessingEnabled: boolean;
  initialPayment: { configured: boolean; recipientName: string; signalAmountCents: number };
  initialPaymentProvider: { activeProvider: PaymentProvider; humanFallbackEnabled: boolean; mercadoPago: MercadoPagoStatus };
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
  const [paymentProvider, setPaymentProvider] = useState(initialPaymentProvider.activeProvider);
  const [providerBaseline, setProviderBaseline] = useState(initialPaymentProvider.activeProvider);
  const [humanFallbackEnabled, setHumanFallbackEnabled] = useState(initialPaymentProvider.humanFallbackEnabled);
  const [fallbackBaseline, setFallbackBaseline] = useState(initialPaymentProvider.humanFallbackEnabled);
  const [mercadoPagoStatus, setMercadoPagoStatus] = useState(initialPaymentProvider.mercadoPago);
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [accountHealth, setAccountHealth] = useState<{ state: "idle" | "checking" | "working" | "failed"; text: string }>({ state: "idle", text: "Conta ainda não testada." });
  const [webhookUrl, setWebhookUrl] = useState("/api/webhooks/mercado-pago");
  const confirmationAccepted = confirmation.trim() === "APAGAR";
  const deletionTargetSelected = deletionScope === "all" || Boolean(selectedCustomerId);
  const deletionEnabled = confirmationAccepted && deletionTargetSelected && !processingEnabled && !deleting;
  const paymentDirty = Boolean(
    pixKey
    || recipientName !== paymentBaseline.recipientName
    || signalAmount !== paymentBaseline.signalAmount,
  );
  const providerDirty = paymentProvider !== providerBaseline || humanFallbackEnabled !== fallbackBaseline;
  const credentialDirty = Boolean(accessToken || webhookSecret);
  const refreshBlocked = paymentDirty || providerDirty || credentialDirty || Boolean(confirmation) || saving || savingPayment || savingProvider || savingCredential || deleting;

  useEffect(() => {
    setProcessingEnabled(initialProcessingEnabled);
  }, [initialProcessingEnabled]);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/mercado-pago`);
  }, []);

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

  async function savePaymentProvider() {
    setSavingProvider(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentProvider: { activeProvider: paymentProvider, humanFallbackEnabled } }),
      });
      const result = await response.json() as { credentialStatus?: MercadoPagoStatus; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o pipeline de pagamento.");
      setProviderBaseline(paymentProvider);
      setFallbackBaseline(humanFallbackEnabled);
      if (result.credentialStatus) setMercadoPagoStatus(result.credentialStatus);
      setMessage("Pipeline de confirmação de pagamento atualizado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o pipeline de pagamento.");
    } finally {
      setSavingProvider(false);
    }
  }

  async function updateMercadoPagoCredential(clear = false) {
    setSavingCredential(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mercadoPago: clear ? { clear: true } : { accessToken, webhookSecret } }),
      });
      const result = await response.json() as { credentialStatus?: MercadoPagoStatus; error?: string };
      if (!response.ok || !result.credentialStatus) throw new Error(result.error ?? "Não foi possível atualizar as credenciais.");
      setMercadoPagoStatus(result.credentialStatus);
      setAccessToken("");
      setWebhookSecret("");
      setAccountHealth({ state: "idle", text: "Conta ainda não testada." });
      setMessage(clear ? "Credenciais armazenadas removidas." : "Credenciais Mercado Pago armazenadas com criptografia.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar as credenciais.");
    } finally {
      setSavingCredential(false);
    }
  }

  async function testMercadoPagoAccount() {
    setAccountHealth({ state: "checking", text: "Consultando a conta sem criar transação..." });
    try {
      const response = await fetch("/api/settings", { method: "POST" });
      const result = await response.json() as { account?: { accountId: string; nickname: string; durationMs: number }; error?: string };
      if (!response.ok || !result.account) throw new Error(result.error ?? "O teste da conta falhou.");
      setAccountHealth({ state: "working", text: `${result.account.nickname} · conta ${result.account.accountId} · ${result.account.durationMs} ms` });
    } catch (error) {
      setAccountHealth({ state: "failed", text: error instanceof Error ? error.message : "O teste da conta falhou." });
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

      <section aria-labelledby="payment-settings-title" className="rounded-lg border border-mist bg-white p-5 shadow-sm sm:p-6 lg:col-span-2">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><CircleDollarSign className="h-5 w-5" /></span><div><h3 id="payment-settings-title" className="font-heading text-base font-semibold text-slate-ink">Pipeline de confirmação do Pix</h3><p className="mt-1 text-sm leading-6 text-stone">Escolha quem confirma a transação e quando a IA pode continuar o atendimento.</p></div></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
          <div>
            <fieldset><legend className="text-xs font-semibold text-slate-ink">Confirmação ativa</legend><div className="mt-1.5 grid grid-cols-2 overflow-hidden rounded-md border border-mist bg-white p-1">{([ ["mercado_pago", "Mercado Pago"], ["manual", "Humana"] ] as const).map(([value, label]) => <label key={value} className={`flex min-h-9 cursor-pointer items-center justify-center rounded px-3 text-sm font-semibold ${paymentProvider === value ? "bg-slate-ink text-white" : "text-stone hover:bg-pearl"}`}><input type="radio" name="paymentProvider" value={value} checked={paymentProvider === value} onChange={() => setPaymentProvider(value)} className="sr-only" />{label}</label>)}</div></fieldset>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-stone"><input type="checkbox" checked={humanFallbackEnabled} onChange={(event) => setHumanFallbackEnabled(event.target.checked)} className="mt-1 accent-deep-teal" /><span><strong className="text-slate-ink">Fallback humano</strong><br />Se a cobrança automática não puder ser criada, usa a chave Pix e aguarda revisão da equipe.</span></label>
            <button type="button" onClick={savePaymentProvider} disabled={!providerDirty || savingProvider || (paymentProvider === "mercado_pago" && !mercadoPagoStatus.configured)} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{savingProvider ? "Salvando..." : "Salvar pipeline"}</button>
          </div>
          <div className="min-w-0 border-t border-mist pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-semibold text-slate-ink">Conta Mercado Pago</h4><p className="mt-1 text-xs text-stone">{mercadoPagoStatus.source === "environment" ? "Credenciais ativas pelo ambiente." : mercadoPagoStatus.source === "database" ? "Credenciais ativas pelo banco criptografado." : "Credenciais não configuradas."}</p></div><button type="button" onClick={testMercadoPagoAccount} disabled={!mercadoPagoStatus.configured || accountHealth.state === "checking"} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-mist px-3 text-xs font-semibold text-slate-ink disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${accountHealth.state === "checking" ? "animate-spin" : ""}`} />Testar conta</button></div>
            <div className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-xs font-medium ${accountHealth.state === "working" ? "bg-emerald-50 text-emerald-700" : accountHealth.state === "failed" ? "bg-red-50 text-red-700" : "bg-pearl text-stone"}`}>{accountHealth.state === "checking" ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /> : accountHealth.state === "working" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}<span>{accountHealth.text}</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-ink">Access Token<input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="new-password" placeholder="Novo Access Token" disabled={!mercadoPagoStatus.storageEncryptionConfigured || savingCredential} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal disabled:bg-pearl" /></label><label className="text-xs font-semibold text-slate-ink">Assinatura secreta do webhook<input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} autoComplete="new-password" placeholder="Nova assinatura secreta" disabled={!mercadoPagoStatus.storageEncryptionConfigured || savingCredential} className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal disabled:bg-pearl" /></label></div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => updateMercadoPagoCredential()} disabled={!mercadoPagoStatus.storageEncryptionConfigured || accessToken.length < 20 || webhookSecret.length < 16 || savingCredential} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-ink px-4 text-sm font-semibold text-white disabled:opacity-50"><KeyRound className="h-4 w-4" />{savingCredential ? "Salvando..." : "Armazenar credenciais"}</button>{mercadoPagoStatus.databaseConfigured && <button type="button" onClick={() => updateMercadoPagoCredential(true)} disabled={savingCredential} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700"><Trash2 className="h-4 w-4" />Remover</button>}</div>
            {!mercadoPagoStatus.storageEncryptionConfigured && <p className="mt-2 text-xs font-semibold text-red-700">Configure PAYMENT_CREDENTIALS_ENCRYPTION_KEY com 32 bytes em Base64.</p>}
            <label className="mt-4 block text-xs font-semibold text-slate-ink">URL para notificações no Mercado Pago<input readOnly value={webhookUrl} className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-pearl px-3 text-xs font-normal text-stone" /></label>
            <p className="mt-2 text-[11px] leading-4 text-stone">Cadastre essa URL como webhook de pagamentos. Variáveis de ambiente têm prioridade e não podem ser alteradas nesta tela.</p>
          </div>
        </div>
        <form onSubmit={savePayment} className="mt-5 grid gap-3 border-t border-mist pt-5 md:grid-cols-3 md:items-end">
          <p className="md:col-span-3 text-xs font-semibold text-slate-ink">Dados do modo humano e fallback</p>
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
            {savingPayment ? "Salvando..." : "Salvar dados Pix"}
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