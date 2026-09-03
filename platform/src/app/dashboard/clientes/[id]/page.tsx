import Link from "next/link";
import { notFound } from "next/navigation";
import { findCustomerById, getCustomerProfileSnapshot } from "@/lib/crm";
import { getAssistantConversationState } from "@/lib/assistant/context";
import { listCustomerAgentRuns } from "@/lib/assistant/agent";
import { getCustomerCalendarOverview } from "@/lib/calendar";
import { listWhatsAppMessagesForCustomer } from "@/lib/whatsapp";
import { getLatestPaymentRequest } from "@/lib/payments";
import AutoRefresh from "../../_components/auto-refresh";
import CustomerDetailTabs from "./_components/customer-detail-tabs";
import CustomerAgentPanel from "./_components/customer-agent-panel";
import LeadQualificationPanel from "./_components/lead-qualification-panel";
import PaymentReviewPanel from "./_components/payment-review-panel";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await findCustomerById(id);
  if (!customer) notFound();
  const profile = getCustomerProfileSnapshot(customer);

  const [messages, agentRuns, conversationState, calendarOverview, payment] = await Promise.all([
    listWhatsAppMessagesForCustomer(customer._id, customer.phones),
    listCustomerAgentRuns(customer._id),
    getAssistantConversationState(customer._id),
    getCustomerCalendarOverview(customer._id),
    getLatestPaymentRequest(customer._id),
  ]);

  const relationshipLabel = profile.relationshipStatus === "new"
    ? "Paciente novo"
    : profile.relationshipStatus === "returning"
      ? "Paciente de retorno"
      : "Classificação pendente";

  return (
    <div className="animate-fade-in-up space-y-6">
      <AutoRefresh />
      <header className="border-b border-mist pb-5">
        <Link href="/dashboard/clientes" className="text-sm font-semibold text-deep-teal hover:text-forest-teal">
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
          <span className="rounded-full bg-deep-teal/10 px-3 py-1.5 text-xs font-semibold text-deep-teal">{relationshipLabel}</span>
        </div>
      </header>

      <CustomerDetailTabs
        summary={(
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <section aria-labelledby="profile-title" className="rounded-lg border border-mist bg-white p-5 sm:p-6">
              <h2 id="profile-title" className="font-heading text-base font-semibold text-slate-ink">Cadastro</h2>
              <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Nome completo" value={profile.fullName ?? "Pendente"} />
                <Detail label="Nascimento" value={profile.birthDate ?? "Pendente"} />
                <Detail label="CPF" value={profile.cpf ?? "Pendente"} />
                <Detail label="Profissão" value={profile.profession ?? "Pendente"} />
                <Detail label="Telefones" value={profile.phones.map((phone) => `+${phone}`).join(", ")} />
              </div>
              <div className="mt-6 border-t border-mist pt-5">
                <Detail
                  label="Endereço"
                  value={profile.address
                    ? `${profile.address.street || "Logradouro não informado"}, ${profile.address.number ?? "s/n"}${profile.address.complement ? `, ${profile.address.complement}` : ""} · ${profile.address.neighborhood} · ${profile.address.city}/${profile.address.state} · CEP ${profile.address.postalCode}`
                    : "Pendente"}
                />
              </div>
              <details className="mt-6 border-t border-mist pt-4">
                <summary className="cursor-pointer text-xs font-semibold text-stone">Identificadores do sistema</summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  {customer.identifiers.map((identifier) => (
                    <span key={`${identifier.kind}:${identifier.value}`} className="rounded-md bg-soft-ivory px-3 py-2 text-xs text-slate-ink/75">
                      {identifier.kind}: {identifier.value}
                    </span>
                  ))}
                </div>
              </details>
            </section>

            <section aria-labelledby="calendar-overview-title" className="self-start rounded-lg border border-mist bg-soft-ivory p-5">
              <p className="text-xs font-semibold uppercase text-deep-teal">Agenda</p>
              <h2 id="calendar-overview-title" className="mt-1 font-heading text-base font-semibold text-slate-ink">Próximo atendimento</h2>
              {calendarOverview.appointment ? (
                <div className="mt-5 space-y-5">
                  <Detail label="Data e hora" value={formatDateTime(calendarOverview.appointment.startAt)} />
                  <Detail label="Profissional" value={calendarOverview.appointment.providerId === "default-doctor" ? "Profissional responsável" : calendarOverview.appointment.providerId} />
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-stone">Nenhum atendimento futuro agendado.</p>
              )}
            </section>
          </div>
        )}
        commercial={(
          <div className="space-y-5">
            <LeadQualificationPanel
              customerId={customer._id.toString()}
              qualification={customer.leadQualification?.version === 2
                && customer.leadQualification.profileFit
                && customer.leadQualification.combinedFit ? {
                ...customer.leadQualification,
                generatedAt: customer.leadQualification.generatedAt.toISOString(),
              } : null}
            />
          </div>
        )}
        automation={(
          <div className="space-y-5">
            <PaymentReviewPanel
              customerId={customer._id.toString()}
              payment={payment ? {
                id: payment._id.toString(),
                amountCents: payment.amountCents,
                status: payment.status,
                createdAt: payment.createdAt.toISOString(),
                reviewedAt: payment.reviewedAt?.toISOString(),
                reviewedBy: payment.reviewedBy,
              } : null}
            />
            <CustomerAgentPanel
              customerId={customer._id.toString()}
              initialServiceStatus={customer.serviceStatus ?? "ai_active"}
              runs={agentRuns.map((run) => ({
                id: run._id.toString(),
                status: run.status,
                configRevision: run.configRevision,
                modelIterations: run.modelIterations,
                toolExecutions: run.toolExecutions,
                mutationsExecuted: run.mutationsExecuted,
                finalDecision: run.finalDecision,
                error: run.error,
                startedAt: run.startedAt.toISOString(),
                completedAt: run.completedAt?.toISOString(),
              }))}
              conversationState={conversationState ? {
                summary: conversationState.summary,
                updatedAt: conversationState.updatedAt.toISOString(),
              } : null}
            />
          </div>
        )}
        conversation={(
          <section aria-labelledby="history-title">
            <div>
              <h2 id="history-title" className="font-heading text-base font-semibold text-slate-ink">Histórico da conversa</h2>
              <p className="mt-1 text-xs text-stone">Visualização para conferência. O envio de mensagens não está disponível nesta tela.</p>
            </div>
            <div className="mt-4 flex min-h-[420px] flex-col gap-3 rounded-lg border border-mist bg-warm-sand/25 p-4 sm:p-6">
              {messages.length === 0 ? (
                <p className="m-auto text-sm text-stone">Nenhuma mensagem registrada.</p>
              ) : messages.map((message) => (
                <article
                  key={message.metaMessageId}
                  className={`max-w-[82%] rounded-lg px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${message.direction === "outbound" ? "self-end rounded-br-sm bg-deep-teal text-white" : "self-start rounded-bl-sm border border-mist bg-white text-slate-ink"}`}
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p>
                  <p className={`mt-1.5 text-right text-[10px] ${message.direction === "outbound" ? "text-white/65" : "text-stone"}`}>{formatDateTime(message.timestamp)}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      />
    </div>
  );
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-stone">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-ink">{value}</p>
    </div>
  );
}

