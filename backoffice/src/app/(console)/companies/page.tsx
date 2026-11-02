import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { listCompanyOverview } from "@/lib/companies";
import { formatDate, formatNumber } from "@/lib/format";

export const metadata = { title: "Clínicas" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = "", status = "" } = await searchParams;
  const all = await listCompanyOverview();
  const query = q.trim().toLowerCase();
  const companies = all.filter((company) =>
    (!query || company.name.toLowerCase().includes(query) || company.id.includes(query)) &&
    (!status || (status === "released" ? company.legacy || company.isolationReady : company.status === status)));

  return (
    <>
      <PageHeader
        title="Clínicas"
        description="Cada clínica tem seus próprios usuários, número de WhatsApp, IA e dados. Uma clínica nova só entra no sistema quando estiver 'Liberada' e a plataforma estiver em modo estrito."
        actions={<Link href="/companies/new" className={buttonClass}><Plus className="h-4 w-4" />Nova clínica</Link>}
      />
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={q} placeholder="Buscar por nome ou ID" className="h-10 w-64 rounded-lg border border-mist bg-white px-3 text-sm" />
        <select name="status" defaultValue={status} className="h-10 rounded-lg border border-mist bg-white px-3 text-sm">
          <option value="">Todos os status</option>
          <option value="active">Ativas</option>
          <option value="test">Em teste</option>
          <option value="suspended">Suspensas</option>
          <option value="released">Com acesso liberado</option>
        </select>
        <button className="h-10 rounded-lg border border-mist bg-white px-4 text-sm font-semibold">Filtrar</button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-mist bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-soft-ivory text-left text-xs uppercase tracking-wide text-slate-ink/50">
            <tr>
              <th className="px-5 py-3">Clínica</th><th className="px-3">Status</th><th className="px-3">WhatsApp</th>
              <th className="px-3 text-right">Usuários</th><th className="px-3 text-right">Pacientes</th>
              <th className="px-3 text-right">Msgs 30d</th><th className="px-3 text-right">IA 30d</th><th className="px-5">Criada em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mist">
            {companies.map((company) => (
              <tr key={company.id} className="hover:bg-soft-ivory/60">
                <td className="px-5 py-3">
                  <Link href={`/companies/${company.id}`} className="font-semibold text-slate-ink hover:text-deep-teal">{company.name}</Link>
                  <p className="font-mono text-[11px] text-slate-ink/40">{company.id}</p>
                </td>
                <td className="px-3"><StatusBadge status={company.status} isolationReady={company.isolationReady} legacy={company.legacy} /></td>
                <td className="px-3 text-xs text-slate-ink/70">{company.phone || <span className="text-slate-ink/35">sem número</span>}</td>
                <td className="px-3 text-right tabular-nums">{company.users}</td>
                <td className="px-3 text-right tabular-nums">{formatNumber(company.customers)}</td>
                <td className="px-3 text-right tabular-nums">{formatNumber(company.messages30d)}</td>
                <td className="px-3 text-right tabular-nums">{formatNumber(company.runs30d)}</td>
                <td className="px-5 text-xs text-slate-ink/60">{formatDate(company.createdAt)}</td>
              </tr>
            ))}
            {companies.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-ink/50">Nenhuma clínica encontrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
