import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { ConfirmationTemplateStatus } from "@/lib/confirmations/template";
import { CONFIRMATION_TEMPLATE_HELP } from "@/lib/confirmations/template-content";

/** Alerts of the appointment confirmation task: template not usable, and events left without confirmation. */
export default function ConfirmationAlert({ template, taskEnabled, unconfirmedUpcoming }: {
  template: ConfirmationTemplateStatus | null;
  taskEnabled: boolean;
  unconfirmedUpcoming: number;
}) {
  const templateProblem = template && template.state !== "approved" && template.state !== "unavailable";
  if (!templateProblem && unconfirmedUpcoming === 0) return null;
  return <div className="space-y-3">
    {templateProblem && <section role="alert" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
      <div className="text-sm leading-6 text-slate-ink">
        <p className="font-semibold">{taskEnabled ? "Os lembretes de confirmação de consulta estão parados" : "Modelo de confirmação de consulta não aprovado"}</p>
        <p className="mt-0.5 text-stone">{CONFIRMATION_TEMPLATE_HELP}</p>
        <p className="mt-0.5">{template.message} <Link href="/dashboard/fluxos" className="font-semibold text-deep-teal underline">Agent Studio › Confirmação de consulta</Link></p>
      </div>
    </section>}
    {unconfirmedUpcoming > 0 && <section role="alert" className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
      <p className="text-sm leading-6 text-slate-ink"><strong>{unconfirmedUpcoming} {unconfirmedUpcoming === 1 ? "evento futuro está" : "eventos futuros estão"} sem confirmação.</strong> O paciente não respondeu aos lembretes; a clínica decide se mantém, liga ou remarca. <Link href="/dashboard/calendario" className="font-semibold text-deep-teal underline">Ver no calendário</Link> (filtro “Sem confirmação”).</p>
    </section>}
  </div>;
}
