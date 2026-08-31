import Link from "next/link";
import { notFound } from "next/navigation";
import { findCustomerById } from "@/lib/crm";
import { getAssistantConversationState, getCustomerFlowOverview } from "@/lib/assistant";
import { getCustomerCalendarOverview } from "@/lib/calendar";
import { listWhatsAppMessagesForCustomer } from "@/lib/whatsapp";
import CustomerFlowPanel from "./_components/customer-flow-panel";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await findCustomerById(id);
  if (!customer) notFound();

  const [messages, flowOverview, conversationState, calendarOverview] = await Promise.all([
    listWhatsAppMessagesForCustomer(customer._id, customer.phones),
    getCustomerFlowOverview(customer._id),
    getAssistantConversationState(customer._id),
    getCustomerCalendarOverview(customer._id),
  ]);

  return (
    <div className="animate-fade-in-up space-y-6">
      <header className="border-b border-mist pb-5">
        <Link href="/dashboard" className="text-sm font-semibold text-deep-teal hover:text-forest-teal">
          ← Clientes
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-slate-ink">
              {customer.name}
            </h1>
            <p className="mt-1 text-sm text-stone">
              {customer.phones.map((phone) => `+${phone}`).join(" · ")}
            </p>
          </div>
          <span className="rounded-full bg-warm-sand px-3 py-1.5 text-xs font-semibold text-slate-ink/70">
            Somente leitura
          </span>
        </div>
      </header>

      <section aria-labelledby="identifiers-title" className="rounded-lg border border-mist bg-white p-5">
        <h2 id="identifiers-title" className="font-heading text-sm font-semibold text-slate-ink">
          Identificadores
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {customer.identifiers.map((identifier) => (
            <span key={`${identifier.kind}:${identifier.value}`} className="rounded-lg border border-mist bg-soft-ivory px-3 py-2 text-xs text-slate-ink/75">
              {identifier.kind}: {identifier.value}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="calendar-overview-title" className="border-y border-mist py-5">
        <h2 id="calendar-overview-title" className="font-heading text-sm font-semibold text-slate-ink">
          Agenda e automações
        </h2>
        {calendarOverview.appointment ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Próximo atendimento" value={formatDateTime(calendarOverview.appointment.startAt)} />
            <Detail label="Profissional" value={calendarOverview.appointment.providerId === "default-doctor" ? "Profissional responsável" : calendarOverview.appointment.providerId} />
            <Detail label="Lembrete" value={calendarOverview.trigger ? formatTriggerStatus(calendarOverview.trigger.status) : "Não programado"} />
            <Detail label="Disparo previsto" value={calendarOverview.trigger ? formatDateTime(calendarOverview.trigger.dueAt) : "—"} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone">Nenhum atendimento futuro agendado.</p>
        )}
      </section>

      <CustomerFlowPanel
        customerId={customer._id.toString()}
        initialServiceStatus={customer.serviceStatus ?? "ai_active"}
        flows={flowOverview.flows.map((flow) => ({
          key: flow.key,
          name: flow.name,
          currentVersion: flow.currentVersion,
        }))}
        assignment={{
          flowKey: flowOverview.assignment.flowKey,
          flowVersion: flowOverview.assignment.flowVersion,
          status: flowOverview.assignment.status,
          stage: flowOverview.assignment.state.stage,
          missingData: flowOverview.assignment.state.missingData,
          startedAt: flowOverview.assignment.startedAt.toISOString(),
          completionReason: flowOverview.assignment.completionReason,
        }}
        history={flowOverview.history.map((item) => ({
          id: item._id.toString(),
          flowKey: item.flowKey,
          flowVersion: item.flowVersion,
          completedAt: item.completedAt.toISOString(),
          completionReason: item.completionReason,
          completionCode: item.completionCode,
          nextFlowKey: item.nextFlowKey,
          source: item.source,
        }))}
        conversationState={conversationState ? {
          summary: conversationState.summary,
          summarizedThrough: conversationState.summarizedThrough.toISOString(),
          updatedAt: conversationState.updatedAt.toISOString(),
        } : null}
      />

      <section aria-labelledby="history-title">
        <div>
          <h2 id="history-title" className="font-heading text-base font-semibold text-slate-ink">
            Histórico da conversa
          </h2>
          <p className="mt-1 text-xs text-stone">
            Visualização para conferência. O envio de mensagens não está disponível nesta tela.
          </p>
        </div>

        <div className="mt-4 flex min-h-[420px] flex-col gap-3 rounded-lg border border-mist bg-warm-sand/25 p-4 sm:p-6">
          {messages.length === 0 ? (
            <p className="m-auto text-sm text-stone">Nenhuma mensagem registrada.</p>
          ) : (
            messages.map((message) => (
              <article
                key={message.metaMessageId}
                className={`max-w-[82%] rounded-lg px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
                  message.direction === "outbound"
                    ? "self-end rounded-br-sm bg-deep-teal text-white"
                    : "self-start rounded-bl-sm border border-mist bg-white text-slate-ink"
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm leading-5">
                  {message.body}
                </p>
                <p className={`mt-1.5 text-right text-[10px] ${message.direction === "outbound" ? "text-white/65" : "text-stone"}`}>
                  {formatDateTime(message.timestamp)} · {formatSource(message.source)}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatSource(source?: string) {
  if (source === "simulator") return "simulado";
  if (source === "meta") return "WhatsApp";
  return "legado";
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-stone">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-ink">{value}</p>
    </div>
  );
}

function formatTriggerStatus(status: string) {
  if (status === "pending") return "Programado";
  if (status === "processing") return "Processando";
  if (status === "completed") return "Enviado";
  if (status === "cancelled") return "Cancelado";
  return "Falhou";
}