import Link from "next/link";
import { Activity, Bot, Clock3, CreditCard, MessageSquareWarning, TriangleAlert } from "lucide-react";
import { getOperationsDashboard } from "@/lib/dashboard/operations";
import AutoRefresh from "../_components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const operations = await getOperationsDashboard();
  const queueNeedsAttention = operations.health.failedJobs > 0 || operations.health.failedMessages > 0;

  return (
    <div className="animate-fade-in-up space-y-7">
      <AutoRefresh />
      <header className="flex flex-col gap-4 border-b border-mist pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-deep-teal">Observabilidade</p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Operações</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Monitore filas, execuções da IA, entregas e decisões financeiras sem acessar conteúdo sensível.</p>
        </div>
        <p className="text-xs font-semibold text-stone">Atualizado {formatTime(operations.generatedAt)}</p>
      </header>

      <section aria-label="Saúde operacional" className="grid gap-px overflow-hidden rounded-lg border border-mist bg-mist sm:grid-cols-2 xl:grid-cols-5">
        <HealthMetric icon={Clock3} label="Na fila" value={operations.health.pendingJobs} detail={`${operations.health.processingJobs} em processamento`} />
        <HealthMetric icon={TriangleAlert} label="Jobs com falha" value={operations.health.failedJobs} detail="aguardando diagnóstico" attention={operations.health.failedJobs > 0} />
        <HealthMetric icon={MessageSquareWarning} label="Falhas de envio" value={operations.health.failedMessages} detail="nas últimas 24 horas" attention={operations.health.failedMessages > 0} />
        <HealthMetric icon={Activity} label="Sucesso do agente" value={`${operations.health.runSuccessRate}%`} detail="execuções em 7 dias" />
        <HealthMetric icon={Bot} label="Latência mediana" value={formatDuration(operations.health.medianModelLatencyMs)} detail="chamadas recentes de IA" />
      </section>

      {queueNeedsAttention && <div role="alert" className="flex items-start gap-3 rounded-lg border border-burnt-coral/25 bg-burnt-coral/[0.06] px-4 py-3"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-burnt-coral" /><div><p className="text-sm font-semibold text-slate-ink">A operação precisa de revisão</p><p className="mt-0.5 text-xs leading-5 text-stone">Priorize jobs com falha e confirme a entrega das mensagens antes de reativar automações.</p></div></div>}

      <div className="grid gap-7 xl:grid-cols-[1.05fr_0.95fr]">
        <OperationalSection title="Fila de automação" eyebrow="Agora" count={operations.jobs.length} empty="Nenhum job aguardando processamento.">
          {operations.jobs.map((job) => <article key={job._id.toString()} className="grid gap-2 border-t border-mist py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={job.status} /><p className="truncate text-sm font-semibold text-slate-ink">{processLabel(job.process)}</p></div><Link href={`/dashboard/clientes/${job.customerId.toString()}`} className="mt-1 block truncate text-xs font-semibold text-deep-teal hover:text-forest-teal">{job.customerName}</Link><p className="mt-1 text-xs text-stone">{eventLabel(job.event)} · revisão {job.revision}{job.consecutiveFailures > 0 ? ` · ${job.consecutiveFailures} tentativa(s) com falha` : ""}</p>{job.lastError && <p className="mt-2 line-clamp-2 text-xs leading-5 text-burnt-coral">{job.lastError}</p>}</div><p className="text-xs text-stone sm:text-right">{formatDateTime(job.updatedAt)}</p></article>)}
        </OperationalSection>

        <OperationalSection title="Execuções do agente" eyebrow="Auditoria" count={operations.runs.length} empty="Nenhuma execução registrada.">
          {operations.runs.map((run) => <article key={run._id.toString()} className="border-t border-mist py-4 first:border-t-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={run.status} /><Link href={`/dashboard/clientes/${run.customerId.toString()}`} className="truncate text-sm font-semibold text-slate-ink hover:text-deep-teal">{run.customerName}</Link></div><p className="mt-1 text-xs text-stone">Configuração r{run.configRevision} · {run.modelIterations} iteração(ões) · {run.toolExecutions} ferramenta(s) · {run.mutationsExecuted} alteração(ões)</p></div><p className="shrink-0 text-xs text-stone">{formatDateTime(run.startedAt)}</p></div>{run.error && <p className="mt-2 line-clamp-2 text-xs leading-5 text-burnt-coral">{run.error}</p>}</article>)}
        </OperationalSection>
      </div>

      <div className="grid gap-7 xl:grid-cols-2">
        <OperationalSection title="Chamadas de IA" eyebrow="Desempenho" count={operations.modelCalls.length} empty="Nenhuma chamada de IA registrada.">
          {operations.modelCalls.map((call) => <article key={call._id.toString()} className="flex items-start justify-between gap-3 border-t border-mist py-4 first:border-t-0"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={call.status} /><p className="truncate text-sm font-semibold text-slate-ink">{taskLabel(call.taskKey)}</p></div><p className="mt-1 truncate text-xs text-stone">{call.customerName} · {call.model} · {formatDuration(call.durationMs ?? 0)}</p>{call.errorMessage && <p className="mt-2 line-clamp-2 text-xs text-burnt-coral">{call.errorMessage}</p>}</div><p className="shrink-0 text-xs text-stone">{formatDateTime(call.startedAt)}</p></article>)}
        </OperationalSection>

        <OperationalSection title="Sinais e pagamentos" eyebrow="Financeiro" count={operations.payments.length} empty="Nenhuma solicitação de sinal registrada." icon={CreditCard}>
          {operations.payments.map((payment) => <article key={payment._id.toString()} className="border-t border-mist py-4 first:border-t-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={payment.status} /><Link href={`/dashboard/clientes/${payment.customerId.toString()}`} className="truncate text-sm font-semibold text-slate-ink hover:text-deep-teal">{payment.customerName}</Link></div><p className="mt-1 text-xs text-stone">{formatCurrency(payment.amountCents)} · solicitado {formatDateTime(payment.createdAt)}</p></div>{payment.reviewedAt && <p className="shrink-0 text-xs text-stone">{payment.reviewedBy ?? "Equipe"}</p>}</div>{payment.reviewNote && <p className="mt-2 rounded-md bg-soft-ivory px-3 py-2 text-xs leading-5 text-slate-ink/75">{payment.reviewNote}</p>}</article>)}
        </OperationalSection>
      </div>
    </div>
  );
}

function HealthMetric({ icon: Icon, label, value, detail, attention = false }: { icon: typeof Activity; label: string; value: number | string; detail: string; attention?: boolean }) {
  return <div className="bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase text-stone">{label}</p><Icon className={`h-4 w-4 ${attention ? "text-burnt-coral" : "text-deep-teal"}`} /></div><p className={`mt-2 font-heading text-2xl font-bold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</p><p className="mt-1 text-xs text-stone">{detail}</p></div>;
}

function OperationalSection({ title, eyebrow, count, empty, icon: Icon, children }: { title: string; eyebrow: string; count: number; empty: string; icon?: typeof Activity; children: React.ReactNode }) {
  return <section className="rounded-lg border border-mist bg-white"><header className="flex items-end justify-between gap-3 border-b border-mist px-5 py-4"><div><p className="text-[11px] font-semibold uppercase text-deep-teal">{eyebrow}</p><h2 className="mt-1 font-heading text-base font-semibold text-slate-ink">{title}</h2></div><div className="flex items-center gap-2 text-stone">{Icon && <Icon className="h-4 w-4" />}<span className="text-xs font-semibold">{count}</span></div></header><div className="max-h-[430px] overflow-y-auto px-5">{count > 0 ? children : <p className="py-10 text-center text-sm text-stone">{empty}</p>}</div></section>;
}

function Status({ value }: { value: string }) {
  const failure = value === "failed" || value === "rejected";
  const active = value === "processing" || value === "running" || value === "started" || value === "awaiting_human_confirmation";
  const label: Record<string, string> = { pending: "Pendente", processing: "Processando", failed: "Falhou", running: "Executando", completed: "Concluído", superseded: "Substituído", started: "Iniciada", paid: "Pago", rejected: "Rejeitado", awaiting_human_confirmation: "Aguardando confirmação" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${failure ? "bg-burnt-coral/10 text-burnt-coral" : active ? "bg-amber-50 text-amber-700" : "bg-deep-teal/10 text-deep-teal"}`}>{label[value] ?? value}</span>;
}

function processLabel(value: string) { return value === "customer_agent" ? "Agente do cliente" : "Qualificação de lead"; }
function eventLabel(value: string) { return ({ "message.received": "Mensagem recebida", "customer.profile.updated": "Cadastro atualizado", "payment.status.changed": "Pagamento alterado", "appointment.status.changed": "Agenda alterada", "manual.requested": "Solicitação manual" } as Record<string, string>)[value] ?? value; }
function taskLabel(value: string) { return value === "customer_agent" ? "Agente do cliente" : value === "lead_qualification" ? "Qualificação de lead" : value; }
function formatDuration(milliseconds: number) { return milliseconds <= 0 ? "—" : milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`; }
function formatDateTime(value: Date) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(value); }
function formatTime(value: Date) { return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(value); }
function formatCurrency(valueCents: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueCents / 100); }