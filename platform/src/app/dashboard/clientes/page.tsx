import Link from "next/link";
import { listCustomerOperations, type CustomerOperationsDocument } from "@/lib/crm";
import AutoRefresh from "../_components/auto-refresh";

export const dynamic = "force-dynamic";

type CustomerFilter = "all" | "attention" | "ai_active" | "human_active" | "scheduled" | "closed";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const parameters = await searchParams;
  const query = parameters.q?.trim() ?? "";
  const status = isCustomerFilter(parameters.status) ? parameters.status : "all";
  const customers = await listCustomerOperations();
  const filtered = customers.filter((customer) => matchesQuery(customer, query) && matchesStatus(customer, status));
  const attentionCount = customers.filter(needsAttention).length;
  const scheduledCount = customers.filter((customer) => Boolean(customer.nextAppointment)).length;
  const qualifiedCount = customers.filter((customer) => Boolean(customer.leadQualification)).length;

  return (
    <div className="animate-fade-in-up space-y-7">
      <AutoRefresh />
      <header className="flex flex-col gap-5 border-b border-mist pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-deep-teal">Relacionamento</p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Clientes</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Acompanhe quem precisa de atenção, o contexto mais recente e o avanço até o agendamento.</p>
        </div>
        <p className="text-xs font-semibold text-stone">{filtered.length} de {customers.length} registro(s)</p>
      </header>

      <section aria-label="Resumo da base" className="grid overflow-hidden rounded-lg border border-mist bg-white sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Base total" value={customers.length} detail="clientes identificados" />
        <Metric label="Ação humana" value={attentionCount} detail="aguardando ou reabertos" attention={attentionCount > 0} />
        <Metric label="Com agenda" value={scheduledCount} detail="próximo evento confirmado" />
        <Metric label="Qualificados" value={qualifiedCount} detail="perfil comercial analisado" />
      </section>

      <form className="grid gap-3 rounded-lg border border-mist bg-white p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
        <label className="text-xs font-semibold text-slate-ink">
          Buscar cliente
          <input name="q" defaultValue={query} placeholder="Nome, telefone, cidade ou contexto" className="mt-1.5 w-full rounded-md border border-mist bg-soft-ivory/50 px-3 py-2.5 text-sm outline-none transition focus:border-deep-teal focus:bg-white" />
        </label>
        <label className="text-xs font-semibold text-slate-ink">
          Situação
          <select name="status" defaultValue={status} className="mt-1.5 w-full rounded-md border border-mist bg-soft-ivory/50 px-3 py-2.5 text-sm outline-none transition focus:border-deep-teal focus:bg-white">
            <option value="all">Todas</option>
            <option value="attention">Precisa de atenção</option>
            <option value="ai_active">Atendimento pela IA</option>
            <option value="human_active">Atendimento humano</option>
            <option value="scheduled">Com agendamento</option>
            <option value="closed">Encerradas</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="rounded-md bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-teal">Aplicar</button>
          {(query || status !== "all") && <Link href="/dashboard/clientes" className="rounded-md border border-mist px-4 py-2.5 text-sm font-semibold text-stone transition hover:border-stone hover:text-slate-ink">Limpar</Link>}
        </div>
      </form>

      <section className="overflow-hidden rounded-lg border border-mist bg-white">
        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-semibold text-slate-ink">Nenhum cliente encontrado</p>
            <p className="mt-1 text-xs text-stone">Ajuste a busca ou os filtros para ampliar os resultados.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-mist lg:hidden">
              {filtered.map((customer) => <CustomerCard key={customer._id.toString()} customer={customer} />)}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1080px] border-collapse text-left">
                <thead className="bg-soft-ivory/80 text-[11px] font-semibold uppercase text-stone">
                  <tr>
                    <th className="px-5 py-3">Cliente</th>
                    <th className="px-5 py-3">Atendimento</th>
                    <th className="px-5 py-3">Perfil</th>
                    <th className="px-5 py-3">Contexto recente</th>
                    <th className="px-5 py-3">Agenda</th>
                    <th className="px-5 py-3">Última interação</th>
                    <th className="px-5 py-3 text-right"><span className="sr-only">Ação</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist">
                  {filtered.map((customer) => (
                    <tr key={customer._id.toString()} className="transition hover:bg-soft-ivory/55">
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-slate-ink">{customer.name}</p>
                        <p className="mt-0.5 text-xs text-stone">{formatPhone(customer.phones[0])}</p>
                      </td>
                      <td className="px-5 py-4"><StatusBadge customer={customer} /><p className="mt-1.5 text-xs text-stone">{ownerLabel(customer)}</p></td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-slate-ink">{profileLabel(customer)}</p>
                        <p className="mt-0.5 text-xs text-stone">{qualificationLabel(customer)}</p>
                      </td>
                      <td className="max-w-[310px] px-5 py-4"><p className="line-clamp-2 text-sm leading-5 text-slate-ink/75">{contextLabel(customer)}</p></td>
                      <td className="px-5 py-4 text-sm text-slate-ink/75">{customer.nextAppointment ? formatDate(customer.nextAppointment.startAt, customer.nextAppointment.timezone) : "Não agendado"}</td>
                      <td className="px-5 py-4 text-sm text-slate-ink/75">{formatDate(customer.lastInteractionAt)}</td>
                      <td className="px-5 py-4 text-right"><Link href={`/dashboard/clientes/${customer._id.toString()}`} className="text-sm font-semibold text-deep-teal hover:text-forest-teal">Ver detalhes</Link></td>
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

function CustomerCard({ customer }: { customer: CustomerOperationsDocument }) {
  return <Link href={`/dashboard/clientes/${customer._id.toString()}`} className="block p-4 transition hover:bg-soft-ivory/60"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-ink">{customer.name}</p><p className="mt-0.5 text-xs text-stone">{formatPhone(customer.phones[0])}</p></div><StatusBadge customer={customer} /></div><p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-ink/75">{contextLabel(customer)}</p><div className="mt-4 grid grid-cols-2 gap-3 border-t border-mist pt-3 text-xs"><div><span className="text-stone">Perfil</span><p className="mt-0.5 font-semibold text-slate-ink">{profileLabel(customer)}</p></div><div><span className="text-stone">Agenda</span><p className="mt-0.5 font-semibold text-slate-ink">{customer.nextAppointment ? formatDate(customer.nextAppointment.startAt, customer.nextAppointment.timezone) : "Não agendado"}</p></div></div></Link>;
}

function Metric({ label, value, detail, attention = false }: { label: string; value: number; detail: string; attention?: boolean }) {
  return <div className="border-b border-mist px-5 py-4 last:border-b-0 sm:nth-[odd]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"><p className="text-[11px] font-semibold uppercase text-stone">{label}</p><p className={`mt-1 font-heading text-2xl font-bold ${attention ? "text-burnt-coral" : "text-slate-ink"}`}>{value}</p><p className="mt-1 text-xs text-stone">{detail}</p></div>;
}

function StatusBadge({ customer }: { customer: CustomerOperationsDocument }) {
  const status = situation(customer);
  const style = status === "Precisa de atenção" ? "bg-burnt-coral/10 text-burnt-coral" : status === "Atendimento humano" ? "bg-slate-ink/10 text-slate-ink" : status === "Encerrado" ? "bg-stone/10 text-stone" : "bg-deep-teal/10 text-deep-teal";
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{status}</span>;
}

function situation(customer: CustomerOperationsDocument) {
  if (needsAttention(customer)) return "Precisa de atenção";
  if (customer.serviceStatus === "human_active") return "Atendimento humano";
  if (customer.serviceStatus === "closed") return "Encerrado";
  if (customer.nextAppointment) return "Agendado";
  return "IA ativa";
}

function needsAttention(customer: CustomerOperationsDocument) {
  return customer.messageAfterClosure || customer.serviceStatus === "waiting_human" || customer.agentRun?.status === "failed";
}

function matchesQuery(customer: CustomerOperationsDocument, query: string) {
  if (!query) return true;
  const normalized = query.toLocaleLowerCase("pt-BR");
  return [customer.name, ...customer.phones, customer.profile?.address?.city, customer.profile?.profession, contextLabel(customer)].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
}

function matchesStatus(customer: CustomerOperationsDocument, status: CustomerFilter) {
  if (status === "all") return true;
  if (status === "attention") return needsAttention(customer);
  if (status === "scheduled") return Boolean(customer.nextAppointment);
  return customer.serviceStatus === status;
}

function isCustomerFilter(value?: string): value is CustomerFilter {
  return ["all", "attention", "ai_active", "human_active", "scheduled", "closed"].includes(value ?? "");
}

function profileLabel(customer: CustomerOperationsDocument) {
  const profile = customer.profile;
  const fields = [profile?.fullName, profile?.birthDate, profile?.cpf, profile?.address, profile?.profession];
  const completed = fields.filter(Boolean).length;
  return completed === fields.length ? "Cadastro completo" : `${completed}/${fields.length} campos essenciais`;
}

function qualificationLabel(customer: CustomerOperationsDocument) {
  const qualification = customer.leadQualification;
  return qualification ? `Fit ${qualification.combinedFit.score}/100 · ${confidenceLabel(qualification.combinedFit.confidence)}` : "Não qualificado";
}

function confidenceLabel(value: "high" | "medium" | "low") {
  return value === "high" ? "alta confiança" : value === "medium" ? "confiança média" : "baixa confiança";
}

function ownerLabel(customer: CustomerOperationsDocument) {
  return customer.serviceStatus === "waiting_human" || customer.serviceStatus === "human_active" || customer.messageAfterClosure ? "Responsável: equipe" : customer.serviceStatus === "closed" ? "Sem responsável" : "Responsável: IA";
}

function contextLabel(customer: CustomerOperationsDocument) {
  const summary = customer.conversationState?.summary.split("\nÚltima resposta enviada:")[0]?.trim();
  if (summary) return summary;
  if (customer.latestMessage) return `${customer.latestMessage.direction === "inbound" ? "Cliente" : "Oria"}: ${customer.latestMessage.body}`;
  return "Sem contexto registrado.";
}

function formatDate(value: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(value);
}

function formatPhone(value?: string) {
  return value ? `+${value}` : "Sem telefone";
}
