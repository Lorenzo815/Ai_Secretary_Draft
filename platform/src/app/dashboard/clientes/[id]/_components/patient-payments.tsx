import Link from "next/link";
import BrowserDateTime from "@/components/browser-date-time";
import type { FinancePayment } from "@/lib/payments/finance";

const STATUS_LABELS: Record<FinancePayment["status"], string> = {
  paid: "Recebido",
  awaiting_human_confirmation: "Aguardando conferência",
  awaiting_provider_confirmation: "Aguardando pagamento",
  rejected: "Recusado ou cancelado",
  provider_error: "Erro no provedor",
};

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/** Every deposit and payment of the patient, with the appointments each one covers. */
export default function PatientPayments({ payments, canOpenFinance }: { payments: FinancePayment[]; canOpenFinance: boolean }) {
  return <section aria-labelledby="patient-payments-title" className="rounded-lg border border-mist bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 id="patient-payments-title" className="font-heading text-sm font-semibold text-slate-ink">Pagamentos</h2>
        <p className="mt-1 text-xs text-stone">Sinais e pagamentos registrados deste paciente e os agendamentos que cada um cobre.</p>
      </div>
      {canOpenFinance && <Link href="/dashboard/financeiro" className="text-xs font-semibold text-deep-teal hover:text-forest-teal">Abrir Financeiro</Link>}
    </div>
    {payments.length === 0
      ? <p className="mt-3 text-xs text-stone">Nenhum pagamento registrado.</p>
      : <ul className="mt-3 divide-y divide-mist">{payments.map((payment) => <li key={payment.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <p className="text-sm font-semibold text-slate-ink">{money(payment.amountCents)} <span className="ml-1 text-xs font-medium text-stone">{payment.refunded ? "Estornado" : STATUS_LABELS[payment.status]}</span></p>
          <p className="text-xs text-stone">{payment.methodLabel}</p>
          <p className="text-xs text-stone">{payment.paidAt ? <>Recebido <BrowserDateTime value={payment.paidAt} /></> : <>Criado <BrowserDateTime value={payment.createdAt} /></>}</p>
        </div>
        <div className="text-xs text-stone">
          {payment.appointments.length === 0
            ? payment.status === "paid" ? <p>Nenhum agendamento vinculado.</p> : null
            : <ul className="space-y-0.5">{payment.appointments.map((appointment) => <li key={appointment.id}><BrowserDateTime value={appointment.startAt} /> · {appointment.eventTypeName}</li>)}</ul>}
          {payment.note && <p className="mt-1 line-clamp-2">“{payment.note}”</p>}
        </div>
      </li>)}</ul>}
  </section>;
}
