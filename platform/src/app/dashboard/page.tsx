import Link from "next/link";
import { CustomerOperationsDocument, listCustomerOperations } from "@/lib/crm";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const customers = await listCustomerOperations();
  const waitingHuman = customers.filter((customer) => customer.serviceStatus === "waiting_human").length;
  const scheduled = customers.filter((customer) => customer.nextAppointment).length;

  return (
    <div className="animate-fade-in-up space-y-6">
      <header className="border-b border-mist pb-5">
        <p className="text-sm font-medium text-deep-teal">CRM</p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">
          Clientes
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">
          Contatos criados automaticamente a partir das mensagens recebidas.
        </p>
      </header>

      <section aria-label="Resumo operacional" className="grid border-y border-mist sm:grid-cols-3">
        <Metric label="Clientes" value={customers.length} />
        <Metric label="Aguardando equipe" value={waitingHuman} />
        <Metric label="Com atendimento marcado" value={scheduled} />
      </section>

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
                  <div><span className="text-stone">Responsável</span><p className="mt-0.5 font-semibold text-slate-ink">{getOwner(customer.serviceStatus)}</p></div>
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
                      {getOwner(customer.serviceStatus)}
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
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-mist px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-semibold uppercase text-stone">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold text-slate-ink">{value}</p>
    </div>
  );
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

function getSituation(customer: CustomerOperationsDocument) {
  if (customer.serviceStatus === "waiting_human") return "Aguardando equipe";
  if (customer.serviceStatus === "human_active") return "Atendimento humano";
  if (customer.serviceStatus === "closed") return "Encerrado";
  if (customer.nextAppointment) return "Agendado";
  if (customer.flow?.status === "active") return "Em atendimento";
  if (customer.flow?.status === "completed") return "Fluxo concluído";
  return "Disponível";
}

function getSituationStyle(customer: CustomerOperationsDocument) {
  if (customer.serviceStatus === "waiting_human") return "bg-burnt-coral/10 text-burnt-coral";
  if (customer.serviceStatus === "human_active") return "bg-slate-ink/10 text-slate-ink";
  if (customer.serviceStatus === "closed") return "bg-stone/10 text-stone";
  if (customer.nextAppointment) return "bg-deep-teal/10 text-deep-teal";
  return "bg-warm-sand text-slate-ink/75";
}

function formatFlow(flowKey?: string) {
  if (flowKey === "initial_triage") return "Triagem inicial";
  if (flowKey === "schedule_appointment") return "Agendamento";
  if (flowKey === "follow_up") return "Acompanhamento";
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
