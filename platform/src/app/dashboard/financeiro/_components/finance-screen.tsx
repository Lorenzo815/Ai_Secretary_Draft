"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CircleDollarSign, Link2, LoaderCircle, Plus, Receipt, Trash2, TriangleAlert, Wallet } from "lucide-react";
import type { FinanceAppointment, FinancePayment } from "@/lib/payments/finance";
import { MANUAL_METHOD_LABELS, MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/lib/payments/manual-methods";

interface FinanceResult {
  timezone: string;
  payments: FinancePayment[];
  totals: { count: number; receivedCents: number; feesCents: number; netCents: number; refundedCents: number; unallocatedCount: number };
}

interface Filters {
  view: "processed" | "all";
  from: string;
  to: string;
  customerId: string;
  source: "" | "mercado_pago" | "manual";
}

const STATUS_LABELS: Record<FinancePayment["status"], string> = {
  paid: "Recebido",
  awaiting_human_confirmation: "Aguardando conferência",
  awaiting_provider_confirmation: "Aguardando pagamento",
  rejected: "Recusado ou cancelado",
  provider_error: "Erro no provedor",
};

const inputClass = "mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal disabled:bg-pearl";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-mist bg-white px-3 text-sm font-semibold text-slate-ink hover:border-deep-teal/50 disabled:opacity-50";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export default function FinanceScreen({ canManage, customers }: { canManage: boolean; customers: Array<{ id: string; label: string }> }) {
  const [filters, setFilters] = useState<Filters>({ view: "processed", from: monthStart(), to: "", customerId: "", source: "" });
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: filters.view });
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.customerId) params.set("customerId", filters.customerId);
      if (filters.source) params.set("source", filters.source);
      const response = await fetch(`/api/finance?${params}`, { cache: "no-store" });
      const data = await response.json() as FinanceResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os pagamentos.");
      setResult(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os pagamentos.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const timezone = result?.timezone ?? "America/Sao_Paulo";
  return <div className="animate-fade-in-up space-y-6">
    <header className="flex flex-col gap-4 border-b border-mist pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-sm font-semibold text-deep-teal">Pagamentos</p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Financeiro</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Sinais recebidos pelo Mercado Pago, Pix conferidos pela equipe e pagamentos registrados manualmente, com os agendamentos que cada um cobre.</p>
      </div>
      {canManage && <button type="button" onClick={() => setRegistering((value) => !value)} className={primaryClass}><Plus className="h-4 w-4" />Registrar pagamento</button>}
    </header>

    {message && <p role="status" className="rounded-md border border-deep-teal/25 bg-deep-teal/5 px-3 py-2 text-sm text-slate-ink">{message}</p>}

    {registering && canManage && <ManualPaymentForm customers={customers} timezone={timezone} onCancel={() => setRegistering(false)} onSaved={() => {
      setRegistering(false);
      setMessage("Pagamento registrado.");
      void load();
    }} />}

    <section aria-label="Filtros" className="grid gap-3 rounded-lg border border-mist bg-white p-4 sm:grid-cols-2 xl:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
      <fieldset><legend className="text-xs font-semibold text-slate-ink">Mostrar</legend>
        <div className="mt-1.5 grid grid-cols-2 overflow-hidden rounded-md border border-mist bg-white p-1">{([["processed", "Recebidos"], ["all", "Todos"]] as const).map(([value, label]) => <label key={value} className={`flex min-h-8 cursor-pointer items-center justify-center rounded px-3 text-sm font-semibold ${filters.view === value ? "bg-slate-ink text-white" : "text-stone hover:bg-pearl"}`}><input type="radio" name="view" value={value} checked={filters.view === value} onChange={() => setFilters({ ...filters, view: value })} className="sr-only" />{label}</label>)}</div>
      </fieldset>
      <label className="text-xs font-semibold text-slate-ink">De<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={inputClass} /></label>
      <label className="text-xs font-semibold text-slate-ink">Até<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={inputClass} /></label>
      <label className="text-xs font-semibold text-slate-ink">Paciente<select value={filters.customerId} onChange={(event) => setFilters({ ...filters, customerId: event.target.value })} className={inputClass}><option value="">Todos</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-ink">Origem<select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value as Filters["source"] })} className={inputClass}><option value="">Todas</option><option value="mercado_pago">Mercado Pago</option><option value="manual">Pix conferido ou registro manual</option></select></label>
    </section>

    {result && <section aria-label="Totais" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-mist bg-mist lg:grid-cols-4">
      <Metric icon={Wallet} label="Recebido" value={money(result.totals.receivedCents)} detail={`${result.totals.count} pagamento(s) no período`} />
      <Metric icon={Receipt} label="Taxas do Mercado Pago" value={money(result.totals.feesCents)} detail="informadas pelo provedor" />
      <Metric icon={CircleDollarSign} label="Líquido" value={money(result.totals.netCents)} detail={result.totals.refundedCents > 0 ? `${money(result.totals.refundedCents)} estornado(s)` : "recebido menos taxas"} />
      <Metric icon={Link2} label="Sem agendamento" value={String(result.totals.unallocatedCount)} detail="pagamentos recebidos sem horário vinculado" attention={result.totals.unallocatedCount > 0} />
    </section>}

    {error && <p role="alert" className="flex items-center gap-2 rounded-md border border-burnt-coral/30 bg-burnt-coral/5 px-3 py-2 text-sm text-burnt-coral"><TriangleAlert className="h-4 w-4" />{error}</p>}
    {loading && !result && <p className="flex items-center gap-2 text-sm text-stone"><LoaderCircle className="h-4 w-4 animate-spin" />Carregando pagamentos...</p>}

    {result && <section aria-label="Pagamentos" className="overflow-hidden rounded-lg border border-mist bg-white">
      {result.payments.length === 0 && <p className="px-4 py-8 text-center text-sm text-stone">{filters.view === "processed" ? "Nenhum pagamento recebido neste período." : "Nenhum pagamento neste período."}</p>}
      {result.payments.map((payment) => <article key={payment.id} className="grid gap-3 border-t border-mist px-4 py-4 first:border-t-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-start">
        <div className="min-w-0">
          <Link href={`/dashboard/clientes/${payment.customerId}`} className="block truncate text-sm font-semibold text-deep-teal hover:text-forest-teal">{payment.customerName}</Link>
          <p className="mt-1 text-xs text-stone">{payment.paidAt ? <>Recebido em {formatDateTime(payment.paidAt, timezone)}</> : <>Criado em {formatDateTime(payment.createdAt, timezone)}</>}</p>
          {payment.note && <p className="mt-1 line-clamp-2 text-xs text-stone">“{payment.note}”</p>}
        </div>
        <div>
          <p className="text-base font-semibold text-slate-ink">{money(payment.amountCents)}</p>
          <p className="mt-0.5 text-xs text-stone">{payment.methodLabel}</p>
          {payment.feeCents !== null && <p className="mt-0.5 text-xs text-stone">Taxa {money(payment.feeCents)} · líquido {money(payment.netCents ?? 0)}</p>}
          <StatusBadge payment={payment} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-ink">Agendamentos cobertos</p>
          {payment.appointments.length === 0
            ? <p className="mt-1 text-xs text-stone">{payment.status === "paid" ? "Nenhum vinculado." : "—"}</p>
            : <ul className="mt-1 space-y-1">{payment.appointments.map((appointment) => <li key={appointment.id} className="text-xs text-stone"><AppointmentLabel appointment={appointment} timezone={timezone} /></li>)}</ul>}
          {allocatingId === payment.id && <AllocationEditor payment={payment} timezone={timezone} onCancel={() => setAllocatingId(null)} onSaved={() => {
            setAllocatingId(null);
            setMessage("Agendamentos do pagamento atualizados.");
            void load();
          }} />}
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-end">
          {canManage && payment.status === "paid" && !payment.refunded && allocatingId !== payment.id && <button type="button" onClick={() => setAllocatingId(payment.id)} className={buttonClass}><Link2 className="h-4 w-4" />Vincular agendamentos</button>}
          {canManage && payment.manualEntry && removingId !== payment.id && <button type="button" onClick={() => setRemovingId(payment.id)} className={`${buttonClass} text-burnt-coral`}><Trash2 className="h-4 w-4" />Remover</button>}
        </div>
        {removingId === payment.id && <RemoveManualPayment payment={payment} onCancel={() => setRemovingId(null)} onRemoved={() => {
          setRemovingId(null);
          setMessage("Pagamento removido. Os agendamentos vinculados continuam agendados.");
          void load();
        }} />}
      </article>)}
    </section>}
  </div>;
}

function ManualPaymentForm({ customers, timezone, onCancel, onSaved }: { customers: Array<{ id: string; label: string }>; timezone: string; onCancel: () => void; onSaved: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ManualPaymentMethod>("pix_direct");
  const [receivedAt, setReceivedAt] = useState(localNow());
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const amountCents = parseAmount(amount);
      if (amountCents === null || amountCents < 1) throw new Error("Informe um valor válido.");
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, amountCents, method, receivedAt: new Date(receivedAt).toISOString(), note, appointmentIds: selected }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível registrar o pagamento.");
      onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível registrar o pagamento.");
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-lg border border-deep-teal/30 bg-white p-5">
    <div><h2 className="text-base font-semibold text-slate-ink">Registrar pagamento recebido</h2><p className="mt-1 text-xs leading-5 text-stone">Para valores recebidos fora do sistema: dinheiro, maquininha, Pix ou transferência direto na conta, convênio. Vincular uma reserva aguardando sinal a confirma (fica “A confirmar”).</p></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-semibold text-slate-ink">Paciente<select required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setSelected([]); }} className={inputClass}><option value="">Selecione</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-ink">Valor (R$)<input required inputMode="decimal" placeholder="100,00" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} /></label>
      <label className="text-xs font-semibold text-slate-ink">Forma de pagamento<select value={method} onChange={(event) => setMethod(event.target.value as ManualPaymentMethod)} className={inputClass}>{MANUAL_PAYMENT_METHODS.map((value) => <option key={value} value={value}>{MANUAL_METHOD_LABELS[value]}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-ink">Recebido em<input required type="datetime-local" value={receivedAt} max={localNow()} onChange={(event) => setReceivedAt(event.target.value)} className={inputClass} /></label>
    </div>
    <label className="block text-xs font-semibold text-slate-ink">Observação<input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={inputClass} /></label>
    {customerId && <AppointmentPicker key={customerId} customerId={customerId} timezone={timezone} selected={selected} change={setSelected} />}
    {error && <p role="alert" className="text-sm text-burnt-coral">{error}</p>}
    <div className="flex gap-2"><button type="submit" disabled={saving || !customerId} className={primaryClass}>{saving ? "Salvando..." : "Registrar"}</button><button type="button" onClick={onCancel} className={buttonClass}>Cancelar</button></div>
  </form>;
}

function RemoveManualPayment({ payment, onCancel, onRemoved }: { payment: FinancePayment; onCancel: () => void; onRemoved: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/${payment.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível remover o pagamento.");
      onRemoved();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Não foi possível remover o pagamento.");
    } finally {
      setSaving(false);
    }
  }

  return <div role="alertdialog" aria-label="Remover pagamento" className="space-y-3 rounded-md border border-burnt-coral/30 bg-burnt-coral/[0.04] p-3 lg:col-span-4">
    <p className="text-sm font-semibold text-slate-ink">Remover o pagamento de {money(payment.amountCents)} ({payment.methodLabel}) de {payment.customerName}?</p>
    <p className="text-xs leading-5 text-stone">{payment.appointments.length > 0 ? "Os agendamentos vinculados continuam agendados, apenas sem este pagamento. " : ""}A remoção fica registrada no histórico financeiro.</p>
    <label className="block text-xs font-semibold text-slate-ink">Motivo<input maxLength={500} placeholder="Opcional (ex.: registrado em duplicidade)" value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} /></label>
    {error && <p role="alert" className="text-xs text-burnt-coral">{error}</p>}
    <div className="flex gap-2"><button type="button" onClick={remove} disabled={saving} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-burnt-coral px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Removendo..." : "Remover pagamento"}</button><button type="button" onClick={onCancel} disabled={saving} className={buttonClass}>Cancelar</button></div>
  </div>;
}

function AllocationEditor({ payment, timezone, onCancel, onSaved }: { payment: FinancePayment; timezone: string; onCancel: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState(payment.appointments.map((appointment) => appointment.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentIds: selected }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="mt-3 space-y-3 rounded-md border border-mist bg-cloud/40 p-3">
    <AppointmentPicker customerId={payment.customerId} timezone={timezone} selected={selected} change={setSelected} />
    {error && <p role="alert" className="text-xs text-burnt-coral">{error}</p>}
    <div className="flex gap-2"><button type="button" onClick={save} disabled={saving} className={primaryClass}>{saving ? "Salvando..." : "Salvar vínculo"}</button><button type="button" onClick={onCancel} className={buttonClass}>Cancelar</button></div>
  </div>;
}

function AppointmentPicker({ customerId, timezone, selected, change }: { customerId: string; timezone: string; selected: string[]; change: (ids: string[]) => void }) {
  const [appointments, setAppointments] = useState<FinanceAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mounted per patient (key=customerId), so the list starts empty for each one.
  useEffect(() => {
    let active = true;
    fetch(`/api/finance/appointments?customerId=${customerId}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { appointments?: FinanceAppointment[]; error?: string };
        if (!response.ok || !data.appointments) throw new Error(data.error ?? "Não foi possível carregar os agendamentos.");
        if (active) setAppointments(data.appointments);
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os agendamentos."); });
    return () => { active = false; };
  }, [customerId]);

  if (error) return <p role="alert" className="text-xs text-burnt-coral">{error}</p>;
  if (!appointments) return <p className="flex items-center gap-2 text-xs text-stone"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Carregando agendamentos...</p>;
  return <fieldset>
    <legend className="text-xs font-semibold text-slate-ink">Agendamentos cobertos por este pagamento</legend>
    {appointments.length === 0
      ? <p className="mt-1 text-xs text-stone">Este paciente não tem reservas ativas nem agendamentos recentes.</p>
      : <div className="mt-1.5 space-y-1">{appointments.map((appointment) => <label key={appointment.id} className="flex cursor-pointer items-start gap-2 text-xs text-stone">
        <input type="checkbox" checked={selected.includes(appointment.id)} onChange={(event) => change(event.target.checked ? [...selected, appointment.id] : selected.filter((id) => id !== appointment.id))} className="mt-0.5 accent-deep-teal" />
        <AppointmentLabel appointment={appointment} timezone={timezone} />
      </label>)}</div>}
  </fieldset>;
}

function AppointmentLabel({ appointment, timezone }: { appointment: FinanceAppointment; timezone: string }) {
  const state = appointment.status === "held"
    ? "reservado, aguardando sinal"
    : appointment.status === "completed"
      ? "realizado"
      : appointment.confirmationStatus === "confirmed" ? "confirmado" : "a confirmar";
  return <span><strong className="font-semibold text-slate-ink">{formatDateTime(appointment.startAt, timezone)}</strong> · {appointment.eventTypeName} · {state}</span>;
}

function StatusBadge({ payment }: { payment: FinancePayment }) {
  const label = payment.refunded ? (payment.refundStatus === "charged_back" ? "Contestado (chargeback)" : "Estornado") : STATUS_LABELS[payment.status];
  const tone = payment.refunded || payment.status === "rejected" || payment.status === "provider_error"
    ? "border-burnt-coral/30 bg-burnt-coral/5 text-burnt-coral"
    : payment.status === "paid" ? "border-deep-teal/30 bg-deep-teal/5 text-deep-teal" : "border-mist bg-pearl text-stone";
  return <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

function Metric({ icon: Icon, label, value, detail, attention }: { icon: typeof Wallet; label: string; value: ReactNode; detail: string; attention?: boolean }) {
  return <div className="bg-white px-4 py-4">
    <p className="flex items-center gap-1.5 text-xs font-semibold text-stone"><Icon className={`h-4 w-4 ${attention ? "text-burnt-coral" : "text-deep-teal"}`} />{label}</p>
    <p className={`mt-1 text-xl font-semibold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</p>
    <p className="mt-0.5 text-[11px] text-stone">{detail}</p>
  </div>;
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** "1.234,50" (Brazilian) or "1234.50" to cents. */
function parseAmount(text: string) {
  const value = Number(text.trim().includes(",") ? text.trim().replace(/\./g, "").replace(",", ".") : text.trim());
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}
