"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface PaymentView {
  id: string;
  amountCents: number;
  status: "awaiting_human_confirmation" | "paid" | "rejected";
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export default function PaymentReviewPanel({
  customerId,
  payment,
}: {
  customerId: string;
  payment: PaymentView | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!payment) return null;

  async function review(action: "confirm" | "reject") {
    setSaving(true);
    setFeedback("");
    const response = await fetch(`/api/customers/${customerId}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const result = await response.json() as { error?: string; deliveryWarning?: string };
    if (response.ok) {
      setFeedback(result.deliveryWarning
        ? `Revisão salva. Aviso ao cliente falhou: ${result.deliveryWarning}`
        : "Revisão do sinal registrada.");
      router.refresh();
    } else {
      setFeedback(result.error ?? "Não foi possível revisar o sinal.");
    }
    setSaving(false);
  }

  const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(payment.amountCents / 100);
  const labels = {
    awaiting_human_confirmation: "Aguardando confirmação humana",
    paid: "Pagamento confirmado",
    rejected: "Pagamento recusado",
  } as const;

  return (
    <section
      aria-labelledby="payment-review-title"
      className={`rounded-lg border p-5 ${payment.status === "awaiting_human_confirmation" ? "border-burnt-coral bg-burnt-coral/[0.04]" : "border-mist bg-white"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {payment.status === "awaiting_human_confirmation" && <p className="mb-1 text-xs font-semibold uppercase text-burnt-coral">Ação necessária</p>}
          <h2 id="payment-review-title" className="font-heading text-sm font-semibold text-slate-ink">Sinal da consulta</h2>
          <p className="mt-1 text-sm text-stone">{amount} · solicitado em {formatDate(payment.createdAt)}</p>
        </div>
        <span className="rounded-full bg-warm-sand px-3 py-1.5 text-xs font-semibold text-slate-ink">{labels[payment.status]}</span>
      </div>
      {payment.status === "awaiting_human_confirmation" ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label className="text-xs font-semibold text-slate-ink">
            Observação da conferência
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional" className="mt-1.5 min-h-10 w-full rounded-md border border-mist px-3 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <button type="button" disabled={saving} onClick={() => review("reject")} className="min-h-10 rounded-md border border-burnt-coral px-4 text-sm font-semibold text-burnt-coral disabled:opacity-50">Recusar</button>
          <button type="button" disabled={saving} onClick={() => review("confirm")} className="min-h-10 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white disabled:opacity-50">Confirmar pagamento</button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone">Revisado {payment.reviewedAt ? `em ${formatDate(payment.reviewedAt)}` : ""}{payment.reviewedBy ? ` por ${payment.reviewedBy}` : ""}.</p>
      )}
      {feedback && <p role="status" className="mt-2 text-xs font-medium text-deep-teal">{feedback}</p>}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}