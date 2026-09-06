import Link from "next/link";
import {
  BellRing,
  BrainCircuit,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  Cpu,
  ListChecks,
  MessageCircleMore,
  Route,
  Sparkles,
} from "lucide-react";
import { CustomerOperationsDocument, listCustomerOperations } from "@/lib/crm";
import { getDashboardOverview } from "@/lib/dashboard/overview";
import AutoRefresh from "./_components/auto-refresh";
import { PanelHeader, SectionHeader } from "./_components/dashboard-section-header";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const query = await searchParams;
  const periodDays = parsePeriod(query.period);
  const [customers, overview] = await Promise.all([listCustomerOperations(), getDashboardOverview(periodDays)]);
  const waitingHuman = customers.filter((customer) => customer.serviceStatus === "waiting_human").length;
  const messagesAfterClosure = customers.filter((customer) => customer.messageAfterClosure);
  const customerById = new Map(customers.map((customer) => [customer._id.toString(), customer]));
  const pendingPaymentCustomerIds = new Set(overview.pendingPayments.map((payment) => payment.customerId.toString()));
  const actionItems = [
    ...messagesAfterClosure.map((customer) => ({
      key: `post-closure-${customer._id.toString()}`,
      href: `/dashboard/clientes/${customer._id.toString()}`,
      label: "Nova mensagem após encerramento",
      customerName: customer.name,
      detail: `Recebida ${formatRelativeTime(customer.latestMessage!.timestamp, overview.generatedAt)} · IA permanece encerrada`,
      tone: "coral" as const,
      timestamp: customer.latestMessage!.timestamp.getTime(),
    })),
    ...overview.pendingPayments.map((payment) => {
      const customer = customerById.get(payment.customerId.toString());
      return {
        key: `payment-${payment.customerId.toString()}`,
        href: customer ? `/dashboard/clientes/${customer._id.toString()}` : "/dashboard",
        label: "Confirmar sinal recebido",
        customerName: customer?.name ?? "Cliente",
        detail: `${formatCurrency(payment.amountCents)} · aguardando desde ${formatDateTime(payment.createdAt)}`,
        tone: "coral" as const,
        timestamp: payment.createdAt.getTime(),
      };
    }),
    ...customers.filter((customer) => (
      customer.serviceStatus === "waiting_human"
      && !pendingPaymentCustomerIds.has(customer._id.toString())
    )).map((customer) => ({
      key: `human-${customer._id.toString()}`,
      href: `/dashboard/clientes/${customer._id.toString()}`,
      label: "Assumir atendimento",
      customerName: customer.name,
      detail: `Encaminhado para a equipe · ${formatRelativeTime(customer.updatedAt, overview.generatedAt)}`,
      tone: "coral" as const,
      timestamp: customer.updatedAt.getTime(),
    })),
    ...customers.filter((customer) => (
      customer.serviceStatus === "ai_active"
      && customer.latestMessage?.direction === "inbound"
      && overview.generatedAt.getTime() - customer.latestMessage.timestamp.getTime() > 10 * 60 * 1_000
    )).map((customer) => ({
      key: `inbound-${customer._id.toString()}`,
      href: `/dashboard/clientes/${customer._id.toString()}`,
      label: "Mensagem ainda sem resposta",
      customerName: customer.name,
      detail: `Recebida ${formatRelativeTime(customer.latestMessage!.timestamp, overview.generatedAt)}`,
      tone: "amber" as const,
      timestamp: customer.latestMessage!.timestamp.getTime(),
    })),
    ...customers.filter((customer) => (
      customer.relationship?.status === "new"
      && customer.latestMessage?.direction === "outbound"
      && getMissingProfileFields(customer).length > 0
    )).map((customer) => ({
      key: `profile-anomaly-${customer._id.toString()}`,
      href: `/dashboard/clientes/${customer._id.toString()}`,
      label: "Revisar cadastro incompleto",
      customerName: customer.name,
      detail: `${getMissingProfileFields(customer).join(", ")} ainda pendente(s) no cadastro`,
      tone: "amber" as const,
      timestamp: customer.updatedAt.getTime(),
    })),
  ].sort((first, second) => first.timestamp - second.timestamp).slice(0, 6);
  return (
    <div className="space-y-8">
      <AutoRefresh />
      <header className="flex flex-col justify-between gap-4 border-b border-mist pb-5 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-medium text-deep-teal">Central de operação</p>
          <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">Visão geral</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Conversão comercial, qualidade das conversas e pendências que precisam de decisão humana.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-stone">Período comercial</span>
          <nav aria-label="Período da visão geral" className="inline-flex overflow-hidden rounded-md border border-mist bg-white">
            {[7, 30, 90].map((days) => (
              <Link
                key={days}
                href={dashboardHref(days)}
                scroll={false}
                aria-current={overview.periodDays === days ? "page" : undefined}
                className={`px-3 py-2 text-xs font-semibold ${overview.periodDays === days ? "bg-deep-teal text-white" : "text-stone hover:bg-soft-ivory hover:text-slate-ink"}`}
              >
                {days} dias
              </Link>
            ))}
          </nav>
          <span className="text-xs text-stone">Atualizado {formatTime(overview.generatedAt)}</span>
        </div>
      </header>

      {messagesAfterClosure.length > 0 && (
        <section role="alert" className="flex flex-col justify-between gap-3 border-l-4 border-burnt-coral bg-burnt-coral/[0.06] px-4 py-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-slate-ink">{messagesAfterClosure.length} cliente(s) enviaram mensagem após o encerramento</p>
            <p className="mt-0.5 text-xs text-stone">A IA não foi reativada. A equipe deve revisar a conversa.</p>
          </div>
          <Link href={`/dashboard/clientes/${messagesAfterClosure[0]._id.toString()}`} className="shrink-0 text-xs font-semibold text-deep-teal hover:text-forest-teal">Revisar agora</Link>
        </section>
      )}

      <nav aria-label="Seções da visão geral" className="sticky top-0 z-30 -mx-4 flex isolate gap-1 overflow-x-auto border-y border-mist bg-[#FCFAF6] px-4 py-2 shadow-[0_6px_16px_rgba(31,41,55,0.08)] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <span className="hidden self-center pr-2 text-[11px] font-semibold uppercase text-stone sm:block">Navegar</span>
        <a href="#agora" className="shrink-0 rounded-md px-3 py-2 text-xs font-semibold text-slate-ink hover:bg-white hover:text-deep-teal">Agora</a>
        <a href="#inteligencia" className="shrink-0 rounded-md px-3 py-2 text-xs font-semibold text-slate-ink hover:bg-white hover:text-deep-teal">Inteligência</a>
        <a href="#resultados" className="shrink-0 rounded-md px-3 py-2 text-xs font-semibold text-slate-ink hover:bg-white hover:text-deep-teal">Resultados</a>
      </nav>

      <div className="space-y-12">
        <section id="agora" aria-labelledby="now-title" className="scroll-mt-6 space-y-7">
          <SectionHeader icon={BellRing} eyebrow="Operação atual" title="O que precisa de atenção agora" description="Conversas, tempo de resposta e decisões pendentes nas últimas 24 horas." titleId="now-title" meta="Atualização contínua" />
            <section aria-label="Resumo executivo" className="grid grid-cols-2 border-y border-mist lg:grid-cols-4">
              <Metric label="Novos pacientes" value={overview.commercialMetrics.newPatients} detail={`em ${overview.periodDays} dias`} />
              <Metric label="Conversão em agenda" value={formatRate(overview.commercialMetrics.schedulingRate, overview.commercialMetrics.newPatients)} detail={`${overview.commercialMetrics.scheduledPatients} de ${overview.commercialMetrics.newPatients} novos pacientes`} />
              <Metric label="Aguardando equipe" value={waitingHuman} detail={waitingHuman > 0 ? "requer ação humana" : "fila em dia"} attention={waitingHuman > 0} />
              <Metric label="Tempo até resposta" value={formatDuration(overview.commercialMetrics.medianResponseMinutes)} detail="mediana no WhatsApp" />
            </section>
            <section className="grid gap-px border-y border-mist bg-mist xl:grid-cols-[0.8fr_1.15fr_0.85fr]">
        <div className="bg-white px-5 py-5">
          <PanelHeader icon={MessageCircleMore} eyebrow="Últimas 24 horas" title="Fluxo de mensagens" action={{ href: "/dashboard/clientes", label: "Ver conversas" }} />
          <div className="mt-5 grid grid-cols-2 gap-px border-y border-mist bg-mist">
            <MacroMetric label="Conversas" value={overview.messageSummary.activeConversations} />
            <MacroMetric label="Recebidas" value={overview.messageSummary.inbound} />
            <MacroMetric label="Enviadas" value={overview.messageSummary.outbound} />
            <MacroMetric label="Falhas" value={overview.messageSummary.failed} attention={overview.messageSummary.failed > 0} />
          </div>
          <p className="mt-4 text-xs leading-5 text-stone"><strong className="text-slate-ink">{overview.messageSummary.deliveredOrRead}</strong> mensagem(ns) enviada(s) já foram entregues ou lidas.</p>
        </div>

          <div className="bg-white px-5 py-5">
          <PanelHeader icon={ListChecks} eyebrow="Prioridades" title="Fila de atenção humana" meta={`${actionItems.length} item(ns)`} />
          <div className="mt-5 divide-y divide-mist border-y border-mist">
            {actionItems.length === 0 && <div className="py-9 text-center"><p className="text-sm font-semibold text-slate-ink">Nenhuma pendência humana imediata</p><p className="mt-1 text-xs text-stone">Pagamentos, encaminhamentos e mensagens sem resposta estão em dia.</p></div>}
            {actionItems.map((item) => (
              <Link key={item.key} href={item.href} className="group flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${item.tone === "coral" ? "bg-burnt-coral" : "bg-amber-500"}`} /><p className="truncate text-sm font-semibold text-slate-ink">{item.label}</p></div><p className="mt-1 truncate pl-4 text-xs text-stone">{item.customerName} · {item.detail}</p></div>
                <span className="shrink-0 text-xs font-semibold text-deep-teal group-hover:text-forest-teal">Abrir</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white px-5 py-5">
          <PanelHeader icon={CalendarDays} eyebrow="Agenda" title="Próximos eventos" action={{ href: "/dashboard/calendario", label: "Abrir calendário" }} />
          <div className="mt-5 divide-y divide-mist border-y border-mist">
            {overview.upcomingAppointments.length === 0 && <p className="py-8 text-center text-sm text-stone">Nenhum evento futuro.</p>}
            {overview.upcomingAppointments.map((appointment, index) => <div key={`${appointment.customerName || "sem-cliente"}-${appointment.startAt.toISOString()}-${index}`} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-ink">{appointment.customerName || "Sem cliente"}</p><p className="mt-0.5 text-xs text-stone">{formatEventType(appointment.eventType as string | undefined)}</p></div><p className="shrink-0 text-right text-xs font-semibold text-deep-teal">{formatDateTime(appointment.startAt)}</p></div>)}
          </div>
        </div>
            </section>
        </section>

        <section id="inteligencia" aria-labelledby="intelligence-title" className="scroll-mt-28 -mx-4 bg-[#F5F1EA] px-4 py-8 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <SectionHeader icon={Sparkles} eyebrow="Inteligência da operação" title="Sinais para decidir e investigar" description="Resumo dos clientes analisados e do trabalho executado pela IA." titleId="intelligence-title" />

          <div className="mt-6 grid gap-px border-y border-mist bg-mist xl:grid-cols-2">
            <article className="bg-white px-5 py-5">
              <PanelHeader icon={BrainCircuit} eyebrow="Qualificação comercial" title="Leitura da base" action={{ href: "/dashboard/clientes", label: "Ver clientes" }} />
              <div className="mt-5 grid grid-cols-2 gap-px border-y border-mist bg-mist sm:grid-cols-4">
                <MacroMetric label="Qualificados" value={overview.commercialMetrics.qualifiedLeads} />
                <MacroMetric label="Cobertura" value={formatRate(percentage(overview.commercialMetrics.qualifiedLeads, overview.commercialMetrics.newPatients), overview.commercialMetrics.newPatients)} />
                <MacroMetric label="Fit médio" value={formatScore(overview.commercialMetrics.averageProfileFit, overview.commercialMetrics.qualifiedLeads)} />
                <MacroMetric label="Fit + intenção" value={formatScore(overview.commercialMetrics.averageCombinedFit, overview.commercialMetrics.qualifiedLeads)} />
              </div>
              <div className="mt-5">
                <p className="text-xs font-semibold text-slate-ink">Tags mais recorrentes</p>
                {overview.topInsightTags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {overview.topInsightTags.map((tag) => <span key={`${tag.label}-${tag.tone}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${insightTagStyle(tag.tone)}`}><span>{tag.label}</span><span className="opacity-65">{tag.count}</span></span>)}
                  </div>
                ) : <p className="mt-2 text-sm text-stone">As tags aparecerão conforme os leads forem qualificados.</p>}
              </div>
            </article>

            <article className="bg-white px-5 py-5">
              <PanelHeader icon={Cpu} eyebrow="IA e automação" title="Atividade do período" action={{ href: "/dashboard/operacoes", label: "Abrir operações" }} tone="coral" />
              <div className="mt-5 grid grid-cols-2 gap-px border-y border-mist bg-mist sm:grid-cols-4">
                <MacroMetric label="Chamadas de IA" value={overview.aiSummary.totalCalls} />
                <MacroMetric label="Agente" value={overview.aiSummary.agentCalls} />
                <MacroMetric label="Qualificações" value={overview.aiSummary.qualificationCalls} />
                <MacroMetric label="Falhas" value={overview.aiSummary.failedCalls} attention={overview.aiSummary.failedCalls > 0} />
              </div>
              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex items-center justify-between border-b border-mist pb-3"><span className="text-stone">Sucesso do agente</span><strong className="text-slate-ink">{overview.aiSummary.runSuccessRate === null ? "—" : `${overview.aiSummary.runSuccessRate}%`}</strong></div>
                <div className="flex items-center justify-between border-b border-mist pb-3"><span className="text-stone">Fila de automação</span><strong className={overview.aiSummary.failedJobs > 0 ? "text-burnt-coral" : "text-slate-ink"}>{overview.aiSummary.pendingJobs} pendente(s) · {overview.aiSummary.failedJobs} falha(s)</strong></div>
              </div>
            </article>
          </div>
        </section>

        <section id="resultados" aria-labelledby="results-title" className="scroll-mt-28 space-y-7 border-t border-mist pt-8">
          <SectionHeader icon={ChartNoAxesCombined} eyebrow="Desempenho comercial" title="Da entrada ao agendamento" description="Conversão, qualidade dos leads e origem dos resultados no período selecionado." titleId="results-title" meta={`${overview.periodDays} dias · ${overview.commercialMetrics.newPatients} novo(s) paciente(s)`} />

          <div className="space-y-7">
            <div className="grid gap-px border-y border-mist bg-mist xl:grid-cols-[1.35fr_0.65fr]">
            <section aria-labelledby="commercial-journey-title" className="bg-white px-5 py-5">
              <PanelHeader icon={Route} eyebrow="Resultados comerciais" title="Avanço da jornada" titleId="commercial-journey-title" meta={`Coorte de ${overview.commercialMetrics.newPatients} novo(s) paciente(s)`} />
              <div className="mt-5 grid grid-cols-2 gap-px border-y border-mist bg-mist lg:grid-cols-4">
                <JourneyMetric label="Novos pacientes" value={overview.commercialMetrics.newPatients} detail="entrada da coorte" />
                <JourneyMetric label="Cadastro completo" value={formatRate(overview.commercialMetrics.profileCompletionRate, overview.commercialMetrics.newPatients)} detail={`${overview.commercialMetrics.profileCompleted} de ${overview.commercialMetrics.newPatients}`} />
                <JourneyMetric label="Sinal confirmado" value={formatRate(overview.commercialMetrics.paymentConfirmationRate, overview.commercialMetrics.paymentRequested)} detail={`${overview.commercialMetrics.paymentConfirmed} de ${overview.commercialMetrics.paymentRequested} solicitações`} />
                <JourneyMetric label="Consulta agendada" value={formatRate(overview.commercialMetrics.schedulingRate, overview.commercialMetrics.newPatients)} detail={`${overview.commercialMetrics.scheduledPatients} de ${overview.commercialMetrics.newPatients}`} />
              </div>
            </section>
              <section className="bg-white px-5 py-5" aria-labelledby="conversion-origin-title">
                <PanelHeader icon={CircleDollarSign} eyebrow="Agendamentos e receita" title="Origem das conversões" titleId="conversion-origin-title" tone="coral" />
                <div className="mt-7">
                  <div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-ink">Origem dos agendamentos</span><span className="text-stone">{overview.appointmentSources.assistant + overview.appointmentSources.manual} no período</span></div>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-mist" aria-label="Distribuição da origem dos agendamentos"><div className="bg-deep-teal" style={{ width: `${sourcePercentage(overview.appointmentSources.assistant, overview.appointmentSources)}%` }} /><div className="bg-burnt-coral" style={{ width: `${sourcePercentage(overview.appointmentSources.manual, overview.appointmentSources)}%` }} /></div>
                  <div className="mt-3 flex justify-between text-xs text-stone"><span>IA {overview.appointmentSources.assistant}</span><span>Manual {overview.appointmentSources.manual}</span></div>
                  <p className="mt-7 border-t border-mist pt-5 text-xs text-stone">Sinais confirmados: <strong className="text-slate-ink">{formatCurrency(overview.paymentSummary.paidAmountCents)}</strong></p>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, attention = false }: { label: string; value: number | string; detail?: string; attention?: boolean }) {
  return (
    <div className="border-b border-mist px-4 py-4 odd:border-r last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <p className="text-xs font-semibold uppercase text-stone">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-bold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-stone">{detail}</p>}
    </div>
  );
}

function JourneyMetric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="bg-white px-4 py-4"><p className="text-xs font-semibold text-stone">{label}</p><p className="mt-1 font-heading text-2xl font-bold text-slate-ink">{value}</p><p className="mt-1 text-xs text-stone">{detail}</p></div>;
}

function MacroMetric({ label, value, attention = false }: { label: string; value: string | number; attention?: boolean }) {
  return <div className="bg-white px-3 py-4"><p className="text-[11px] font-semibold uppercase text-stone">{label}</p><p className={`mt-1 font-heading text-xl font-bold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</p></div>;
}

function insightTagStyle(tone: "positive" | "attention" | "info" | "neutral") {
  if (tone === "positive") return "bg-deep-teal/10 text-deep-teal";
  if (tone === "attention") return "bg-burnt-coral/10 text-burnt-coral";
  if (tone === "info") return "bg-sky-50 text-sky-700";
  return "bg-stone/10 text-stone";
}

function formatEventType(eventType?: string) {
  if (eventType === "doctor_consultation") return "Consulta Dr.";
  if (eventType === "bioimpedance") return "Bioimpedância";
  if (eventType === "follow_up") return "Retorno";
  if (eventType === "evaluation") return "Avaliação";
  if (eventType === "blocked") return "Bloqueio de agenda";
  return "Consulta";
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueCents / 100);
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}min`;
}

function formatRate(rate: number, sampleSize: number) {
  return sampleSize > 0 ? `${rate}%` : "—";
}

function formatScore(score: number, sampleSize: number) {
  return sampleSize > 0 ? `${score}/100` : "—";
}

function parsePeriod(value: string | undefined) {
  const period = Number(value);
  return period === 7 || period === 90 ? period : 30;
}

function dashboardHref(period: number) {
  return `/dashboard?period=${period}`;
}

function formatRelativeTime(date: Date, referenceDate: Date) {
  const minutes = Math.max(0, Math.round((referenceDate.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)} dia(s)`;
}

function sourcePercentage(value: number, sources: { assistant: number; manual: number }) {
  return percentage(value, sources.assistant + sources.manual);
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function getMissingProfileFields(customer: CustomerOperationsDocument) {
  const labels: string[] = [];
  if (!customer.profile?.fullName) labels.push("nome");
  if (!customer.profile?.birthDate) labels.push("nascimento");
  if (!customer.profile?.cpf) labels.push("CPF");
  if (!customer.profile?.address?.number) labels.push("endereço");
  if (!customer.profile?.profession) labels.push("profissão");
  return labels;
}
