import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Card, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { AUDIT_COLLECTION } from "@/lib/audit";
import { listCompanyOverview } from "@/lib/companies";
import { listCollectionsInfo } from "@/lib/explorer";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { getDb } from "@/lib/mongodb";

export default async function OverviewPage() {
  const [companies, collections, recent] = await Promise.all([
    listCompanyOverview(),
    listCollectionsInfo(),
    getDb().then((db) => db.collection(AUDIT_COLLECTION).find({}, { projection: { before: 0, after: 0 } }).sort({ at: -1 }).limit(8).toArray()),
  ]);
  const total = (key: "dataBytes" | "storageBytes" | "indexBytes") => collections.reduce((sum, collection) => sum + collection[key], 0);
  const [dataSize, storageSize, indexSize] = [total("dataBytes"), total("storageBytes"), total("indexBytes")];
  const largest = [...collections].sort((a, b) => b.dataBytes - a.dataBytes).slice(0, 8);
  const sum = (key: "customers" | "messages30d" | "runs30d") => companies.reduce((total, company) => total + company[key], 0);

  return (
    <>
      <PageHeader title="Visão geral" description="Situação de todas as clínicas e do banco de dados da Oria." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Clínicas" value={companies.length} hint={`${companies.filter((c) => c.legacy || c.isolationReady).length} com acesso liberado`} />
        <Stat label="Pacientes" value={formatNumber(sum("customers"))} />
        <Stat label="Mensagens (30 dias)" value={formatNumber(sum("messages30d"))} />
        <Stat label="Execuções de IA (30 dias)" value={formatNumber(sum("runs30d"))} />
        <Stat label="Data Size" value={formatBytes(dataSize)} hint={`Storage ${formatBytes(storageSize)} · índices ${formatBytes(indexSize)} · ${collections.length} coleções · limite M0 512 MB (dados + índices: ${Math.round(((dataSize + indexSize) / 512e6) * 100)}%)`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Clínicas" actions={<Link href="/companies" className="inline-flex items-center gap-1 text-sm font-semibold text-deep-teal">Gerenciar <ArrowRight className="h-4 w-4" /></Link>}>
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft-ivory text-left text-xs uppercase tracking-wide text-slate-ink/50">
                <tr><th className="px-5 py-2.5">Clínica</th><th className="px-3">Status</th><th className="px-3 text-right">Pacientes</th><th className="px-3 text-right">Msgs 30d</th><th className="px-5 text-right">IA 30d</th></tr>
              </thead>
              <tbody className="divide-y divide-mist">
                {companies.map((company) => (
                  <tr key={company.id} className="hover:bg-soft-ivory/60">
                    <td className="px-5 py-3"><Link href={`/companies/${company.id}`} className="font-semibold text-slate-ink hover:text-deep-teal">{company.name}</Link></td>
                    <td className="px-3"><StatusBadge status={company.status} isolationReady={company.isolationReady} legacy={company.legacy} /></td>
                    <td className="px-3 text-right tabular-nums">{formatNumber(company.customers)}</td>
                    <td className="px-3 text-right tabular-nums">{formatNumber(company.messages30d)}</td>
                    <td className="px-5 text-right tabular-nums">{formatNumber(company.runs30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Maiores coleções" description="Data Size (sem compressão), como no Atlas">
          <ul className="space-y-2.5">
            {largest.map((collection) => (
              <li key={collection.name}>
                <div className="flex justify-between text-xs">
                  <Link href={`/data/${collection.name}`} className="font-mono font-medium text-slate-ink hover:text-deep-teal">{collection.name}</Link>
                  <span className="tabular-nums text-slate-ink/60">{formatBytes(collection.dataBytes)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-stone-100">
                  <div className="h-1.5 rounded-full bg-deep-teal" style={{ width: `${Math.max(2, (collection.dataBytes / (largest[0]?.dataBytes || 1)) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6" title="Últimas alterações pelo back-office" actions={<Link href="/audit" className="text-sm font-semibold text-deep-teal">Ver tudo</Link>}>
        {recent.length === 0 ? <p className="text-sm text-slate-ink/50">Nenhuma alteração registrada ainda.</p> : (
          <ul className="divide-y divide-mist text-sm">
            {recent.map((entry) => (
              <li key={String(entry._id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-32 text-xs tabular-nums text-slate-ink/50">{formatDate(entry.at)}</span>
                <Badge tone="teal">{String(entry.action)}</Badge>
                {entry.collection && <span className="font-mono text-xs text-slate-ink/70">{String(entry.collection)}</span>}
                {entry.detail && <span className="text-xs text-slate-ink/60">{String(entry.detail)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
