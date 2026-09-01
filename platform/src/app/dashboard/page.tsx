import Link from "next/link";
import { CustomerOperationsDocument, listCustomerOperations } from "@/lib/crm";
import { getDashboardOverview } from "@/lib/dashboard/overview";
import AutoRefresh from "./_components/auto-refresh";
import DashboardSections from "./_components/dashboard-sections";
import OverviewCharts from "./_components/overview-charts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [customers, overview] = await Promise.all([listCustomerOperations(), getDashboardOverview()]);
  const waitingHuman = customers.filter((customer) => customer.serviceStatus === "waiting_human").length;
  const messagesAfterClosure = customers.filter((customer) => customer.messageAfterClosure);
  const inboundMessages = Number(overview.messageDirections.inbound ?? 0);
  const outboundMessages = Number(overview.messageDirections.outbound ?? 0);
  const pendingJobs = Number(overview.jobStatuses.pending ?? 0);
  const failedJobs = Number(overview.jobStatuses.failed ?? 0);
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
      && isBeyondProfileFlow(customer.flow?.flowKey)
      && getMissingProfileFields(customer).length > 0
    )).map((customer) => ({
      key: `profile-anomaly-${customer._id.toString()}`,
      href: `/dashboard/clientes/${customer._id.toString()}`,
      label: "Revisar cadastro incompleto",
      customerName: customer.name,
      detail: `${getMissingProfileFields(customer).join(", ")} pendente(s) no fluxo ${formatFlow(customer.flow?.flowKey)}`,
      tone: "amber" as const,
      timestamp: customer.updatedAt.getTime(),
    })),
  ].sort((first, second) => first.timestamp - second.timestamp).slice(0, 6);
  const totalActiveFlows = overview.activeFlows.reduce((total, flow) => total + flow.count, 0);

  return (
    <div className="animate-fade-in-up space-y-8">
      <AutoRefresh />
      <header className="flex flex-col justify-between gap-4 border-b border-mist pb-5 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-medium text-deep-teal">Central de operação</p>
          <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">Visão geral</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Conversão comercial, qualidade das conversas e pendências que precisam de decisão humana.</p>
        </div>
        <p className="text-xs font-semibold text-stone">Coorte comercial: últimos {overview.periodDays} dias</p>
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

      <DashboardSections
        operation={(
          <div className="space-y-7">
            <section aria-label="Resumo executivo" className="grid border-y border-mist sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <Metric label="Conversas em 24h" value={inboundMessages + outboundMessages} detail={`${inboundMessages} recebidas · ${outboundMessages} enviadas`} />
              <Metric label="Novos pacientes" value={overview.commercialMetrics.newPatients} detail={`em ${overview.periodDays} dias`} />
              <Metric label="Conversão em agenda" value={`${overview.commercialMetrics.schedulingRate}%`} detail="novos pacientes com consulta" />
              <Metric label="Aguardando equipe" value={waitingHuman} detail={waitingHuman > 0 ? "requer ação humana" : "fila em dia"} attention={waitingHuman > 0} />
              <Metric label="Tempo até resposta" value={formatDuration(overview.commercialMetrics.medianResponseMinutes)} detail="mediana no WhatsApp" />
            </section>
            <section className="grid gap-7 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="border-y border-mist py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase text-stone">Prioridades</p><h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Fila de atenção humana</h2></div>
            <span className="text-xs font-semibold text-stone">{actionItems.length} item(ns) visível(is)</span>
          </div>
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

        <div className="border-y border-mist py-5">
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-stone">Agenda</p><h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Próximos eventos</h2></div><Link href="/dashboard/calendario" className="text-xs font-semibold text-deep-teal hover:text-forest-teal">Abrir calendário</Link></div>
          <div className="mt-5 divide-y divide-mist border-y border-mist">
            {overview.upcomingAppointments.length === 0 && <p className="py-8 text-center text-sm text-stone">Nenhum evento futuro.</p>}
            {overview.upcomingAppointments.map((appointment, index) => <div key={`${appointment.customerName || "sem-cliente"}-${appointment.startAt.toISOString()}-${index}`} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-ink">{appointment.customerName || "Sem cliente"}</p><p className="mt-0.5 text-xs text-stone">{formatEventType(appointment.eventType as string | undefined)}</p></div><p className="shrink-0 text-right text-xs font-semibold text-deep-teal">{formatDateTime(appointment.startAt)}</p></div>)}
          </div>
        </div>
            </section>
          </div>
        )}
        performance={(
          <div className="space-y-7">
            <div className="grid gap-7 xl:grid-cols-[0.8fr_1.2fr]">
              <div className="border-y border-mist py-5">
                <div><p className="text-xs font-semibold uppercase text-stone">Leitura comercial</p><h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Qualidade e conversão</h2></div>
                <div className="mt-5 grid grid-cols-2 border-y border-mist">
                  <InsightMetric label="Fit do cadastro" value={`${overview.commercialMetrics.averageProfileFit}/100`} detail={`${overview.commercialMetrics.qualifiedLeads} lead(s) avaliado(s)`} />
                  <InsightMetric label="Fit + intenção" value={`${overview.commercialMetrics.averageCombinedFit}/100`} detail="média atual da base avaliada" />
                  <InsightMetric label="Cadastro completo" value={`${overview.commercialMetrics.profileCompletionRate}%`} detail="entre novos pacientes" />
                  <InsightMetric label="Sinal confirmado" value={`${overview.commercialMetrics.paymentConfirmationRate}%`} detail={`${overview.paymentSummary.paidCount} pago(s) · ${overview.paymentSummary.pendingCount} pendente(s)`} />
                  <InsightMetric label="Pergunta explícita" value={`${overview.commercialMetrics.explicitQuestionRate}%`} detail="respostas que terminam em ?" />
                  <InsightMetric label="Novo × retorno" value={`${overview.commercialMetrics.newPatients} × ${overview.commercialMetrics.returningPatients}`} detail="classificados no período" />
                </div>
              </div>
              <div className="border-y border-mist py-5">
                <p className="text-xs font-semibold uppercase text-stone">Agendamentos e receita</p>
                <h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Origem das conversões</h2>
                <div className="mt-7">
                  <div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-ink">Origem dos agendamentos</span><span className="text-stone">{overview.appointmentSources.assistant + overview.appointmentSources.manual} no período</span></div>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-mist" aria-label="Distribuição da origem dos agendamentos"><div className="bg-deep-teal" style={{ width: `${sourcePercentage(overview.appointmentSources.assistant, overview.appointmentSources)}%` }} /><div className="bg-burnt-coral" style={{ width: `${sourcePercentage(overview.appointmentSources.manual, overview.appointmentSources)}%` }} /></div>
                  <div className="mt-3 flex justify-between text-xs text-stone"><span>IA {overview.appointmentSources.assistant}</span><span>Manual {overview.appointmentSources.manual}</span></div>
                  <p className="mt-7 border-t border-mist pt-5 text-xs text-stone">Sinais confirmados no período: <strong className="text-slate-ink">{formatCurrency(overview.paymentSummary.paidAmountCents)}</strong></p>
                </div>
              </div>
            </div>
            <OverviewCharts activity={overview.activitySeries} funnel={overview.funnel} leadFit={overview.leadFitSeries} />
          </div>
        )}
        automation={(
          <section className="max-w-3xl">

        <div className="border-y border-mist py-5">
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-stone">Automação</p><h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Saúde e fluxos ativos</h2></div><Link href="/dashboard/fluxos" className="text-xs font-semibold text-deep-teal hover:text-forest-teal">Ver fluxos</Link></div>
          <div className="mt-5 divide-y divide-mist border-y border-mist"><StatusRow label="Jobs pendentes" value={pendingJobs} attention={pendingJobs > 0} /><StatusRow label="Jobs com falha" value={failedJobs} attention={failedJobs > 0} /><StatusRow label="Respostas da IA em 24h" value={overview.flowRunsLast24Hours} /><StatusRow label="Mensagens com falha em 24h" value={overview.messageFailures} attention={overview.messageFailures > 0} /></div>
          <div className="mt-5 space-y-3">
            {overview.activeFlows.length === 0 && <p className="text-xs text-stone">Nenhum fluxo ativo.</p>}
            {overview.activeFlows.map((flow) => <div key={flow.key}><div className="flex justify-between gap-3 text-xs"><span className="font-semibold text-slate-ink">{formatFlow(flow.key)}</span><span className="text-stone">{flow.count}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist"><div className="h-full bg-deep-teal" style={{ width: `${percentage(flow.count, totalActiveFlows)}%` }} /></div></div>)}
          </div>
        </div>

          </section>
        )}
        customers={(
          <div className="space-y-5">

      <div className="flex items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-xs font-semibold uppercase text-stone">CRM</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Clientes</h2>
        </div>
        <span className="text-xs font-semibold text-stone">{customers.length} registro(s)</span>
      </div>

      <section className="overflow-hidden rounded-lg border border-mist bg-white">
        {customers.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-semibold text-slate-ink">
              Nenhum cliente cadastrado
            </p>
            <p className="mt-1 text-xs text-stone">
              Um cliente será criado quando chegar a primeira mensagem.
            </p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-mist lg:hidden">
            {customers.map((customer) => (
              <Link key={customer._id.toString()} href={`/dashboard/clientes/${customer._id.toString()}`} className="block px-4 py-4 hover:bg-soft-ivory">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-ink">{customer.name}</p>
                    <p className="mt-0.5 text-xs text-stone">{customer.phones[0] ? `+${customer.phones[0]}` : "Sem telefone"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${getSituationStyle(customer)}`}>{getSituation(customer)}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-stone">Responsável</span><p className="mt-0.5 font-semibold text-slate-ink">{getCustomerOwner(customer)}</p></div>
                  <div><span className="text-stone">Fluxo</span><p className="mt-0.5 font-semibold text-slate-ink">{formatFlow(customer.flow?.flowKey)}</p></div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-ink/75">{getContext(customer)}</p>
                <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-mist pt-3 text-xs text-stone">
                  <span>{customer.nextAppointment ? formatAppointment(customer.nextAppointment.startAt, customer.nextAppointment.timezone) : "Sem agendamento"}</span>
                  <span>Última interação {formatDateTime(customer.lastInteractionAt)}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Responsável</th>
                  <th className="px-5 py-3">Situação</th>
                  <th className="px-5 py-3">Fluxo atual</th>
                  <th className="px-5 py-3">Contexto</th>
                  <th className="px-5 py-3">Próximo atendimento</th>
                  <th className="px-5 py-3">Última interação</th>
                  <th className="px-5 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist">
                {customers.map((customer) => (
                  <tr key={customer._id.toString()}>
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-slate-ink">
                        {customer.name}
                      </p>
                      <p className="mt-0.5 text-xs text-stone">
                        {customer.phones[0] ? `+${customer.phones[0]}` : "Sem telefone"}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-ink">
                      {getCustomerOwner(customer)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getSituationStyle(customer)}`}>
                        {getSituation(customer)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-slate-ink">{formatFlow(customer.flow?.flowKey)}</p>
                      <p className="mt-0.5 text-xs text-stone">
                        {customer.flow ? `${customer.flow.status === "active" ? "Em andamento" : "Concluído"} · ${formatStage(customer.flow.state.stage)}` : "Sem fluxo"}
                      </p>
                    </td>
                    <td className="max-w-[300px] px-5 py-4">
                      <p className="line-clamp-2 text-sm leading-5 text-slate-ink/75">
                        {getContext(customer)}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-ink/75">
                      {customer.nextAppointment
                        ? formatAppointment(customer.nextAppointment.startAt, customer.nextAppointment.timezone)
                        : "Não agendado"}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-ink/75">
                      {formatDateTime(customer.lastInteractionAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/dashboard/clientes/${customer._id.toString()}`}
                        className="text-sm font-semibold text-deep-teal hover:text-forest-teal"
                      >
                        Abrir cliente
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
          </div>
        )}
      />
    </div>
  );
}

function Metric({ label, value, detail, attention = false }: { label: string; value: number | string; detail?: string; attention?: boolean }) {
  return (
    <div className="border-b border-mist px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-semibold uppercase text-stone">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-bold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-stone">{detail}</p>}
    </div>
  );
}

function InsightMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border-b border-mist px-3 py-4 odd:border-r last:border-b-0 [&:nth-last-child(2)]:border-b-0">
      <p className="text-xs font-semibold text-stone">{label}</p>
      <p className="mt-1 font-heading text-xl font-bold text-slate-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-stone">{detail}</p>
    </div>
  );
}

function StatusRow({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className="flex items-center justify-between gap-4 py-3 text-sm"><span className="text-slate-ink/75">{label}</span><span className={`font-bold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</span></div>;
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

function getOwner(status?: CustomerOperationsDocument["serviceStatus"]) {
  if (status === "waiting_human" || status === "human_active") return "Equipe";
  if (status === "closed") return "Nenhum";
  return "IA";
}

function getCustomerOwner(customer: CustomerOperationsDocument) {
  if (customer.messageAfterClosure) return "Equipe";
  return getOwner(customer.serviceStatus);
}

function getSituation(customer: CustomerOperationsDocument) {
  if (customer.messageAfterClosure) return "Nova mensagem após encerramento";
  if (customer.serviceStatus === "waiting_human") return "Aguardando equipe";
  if (customer.serviceStatus === "human_active") return "Atendimento humano";
  if (customer.serviceStatus === "closed") return "Encerrado";
  if (customer.nextAppointment) return "Agendado";
  if (customer.flow?.status === "active") return "Em atendimento";
  if (customer.flow?.status === "completed") return "Fluxo concluído";
  return "Disponível";
}

function getSituationStyle(customer: CustomerOperationsDocument) {
  if (customer.messageAfterClosure) return "bg-burnt-coral/10 text-burnt-coral";
  if (customer.serviceStatus === "waiting_human") return "bg-burnt-coral/10 text-burnt-coral";
  if (customer.serviceStatus === "human_active") return "bg-slate-ink/10 text-slate-ink";
  if (customer.serviceStatus === "closed") return "bg-stone/10 text-stone";
  if (customer.nextAppointment) return "bg-deep-teal/10 text-deep-teal";
  return "bg-warm-sand text-slate-ink/75";
}

function formatFlow(flowKey?: string) {
  if (flowKey === "initial_triage") return "Triagem inicial";
  if (flowKey === "collect_profile") return "Cadastro";
  if (flowKey === "commercial_information") return "Comercial";
  if (flowKey === "payment_confirmation") return "Confirmação do sinal";
  if (flowKey === "schedule_appointment") return "Agendamento";
  return flowKey ?? "Sem fluxo";
}

function formatStage(stage: string) {
  return stage.replaceAll("_", " ");
}

function getContext(customer: CustomerOperationsDocument) {
  const summary = customer.conversationState?.summary.split("\nÚltima resposta enviada:")[0]?.trim();
  if (summary) return summary;
  if (customer.latestMessage) {
    return `${customer.latestMessage.direction === "inbound" ? "Cliente" : "IA"}: ${customer.latestMessage.body}`;
  }
  return "Sem contexto registrado.";
}

function formatAppointment(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
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

function isBeyondProfileFlow(flowKey?: string) {
  return flowKey === "commercial_information"
    || flowKey === "payment_confirmation"
    || flowKey === "schedule_appointment";
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
