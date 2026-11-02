import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Filter } from "mongodb";
import { Badge, PageHeader, inputClass, labelClass } from "@/components/ui";
import { toEjson } from "@/lib/actions";
import { AUDIT_COLLECTION } from "@/lib/audit";
import { companyNames } from "@/lib/explorer";
import { formatDate, formatNumber } from "@/lib/format";
import { getDb } from "@/lib/mongodb";

export const metadata = { title: "Auditoria" };

type Search = { action?: string; collection?: string; actor?: string; company?: string; page?: string };
const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const db = await getDb();
  const filter: Filter<Record<string, unknown>> = {};
  if (search.action) filter.action = { $regex: `^${search.action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` };
  if (search.collection) filter.collection = search.collection;
  if (search.actor) filter.actor = search.actor.trim().toLowerCase();
  if (search.company) filter.companyId = search.company;
  const page = Math.max(1, Number(search.page ?? 1) || 1);
  const [entries, total, actions, collections, names] = await Promise.all([
    db.collection(AUDIT_COLLECTION).find(filter).sort({ at: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    db.collection(AUDIT_COLLECTION).countDocuments(filter),
    db.collection(AUDIT_COLLECTION).distinct("action"),
    db.collection(AUDIT_COLLECTION).distinct("collection"),
    companyNames(),
  ]);
  const pageHref = (target: number) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(search).filter(([, v]) => v)), page: String(target) })}`;

  return (
    <>
      <PageHeader title="Auditoria" description="Todas as alterações e revelações de segredos feitas pelo back-office, com o antes e o depois (segredos mascarados)." />
      <form method="get" className="mb-4 grid gap-3 rounded-2xl border border-mist bg-white p-4 shadow-sm sm:grid-cols-5">
        <label><span className={labelClass}>Ação</span>
          <select name="action" defaultValue={search.action ?? ""} className={`${inputClass} mt-1`}><option value="">Todas</option>{actions.sort().map((action) => <option key={String(action)}>{String(action)}</option>)}</select>
        </label>
        <label><span className={labelClass}>Coleção</span>
          <select name="collection" defaultValue={search.collection ?? ""} className={`${inputClass} mt-1`}><option value="">Todas</option>{collections.filter(Boolean).sort().map((name) => <option key={String(name)}>{String(name)}</option>)}</select>
        </label>
        <label><span className={labelClass}>Clínica</span>
          <select name="company" defaultValue={search.company ?? ""} className={`${inputClass} mt-1`}><option value="">Todas</option>{[...names.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </label>
        <label><span className={labelClass}>Autor</span><input name="actor" defaultValue={search.actor} className={`${inputClass} mt-1`} /></label>
        <div className="flex items-end"><button className="h-10 w-full rounded-lg bg-slate-ink text-sm font-semibold text-white">Filtrar</button></div>
      </form>
      <p className="mb-2 text-sm text-slate-ink/60">{formatNumber(total)} registro(s)</p>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={String(entry._id)} className="rounded-xl border border-mist bg-white shadow-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="w-32 text-xs tabular-nums text-slate-ink/50">{formatDate(entry.at)}</span>
                <Badge tone={String(entry.action).includes("delete") ? "red" : String(entry.action).includes("reveal") ? "amber" : "teal"}>{String(entry.action)}</Badge>
                {entry.collection && <code className="text-xs">{String(entry.collection)}</code>}
                {entry.companyId && <span className="text-xs text-slate-ink/60">{names.get(String(entry.companyId)) ?? String(entry.companyId)}</span>}
                {entry.count !== undefined && entry.count !== null && <span className="text-xs">{String(entry.count)} doc(s)</span>}
                {entry.detail && <span className="text-xs text-slate-ink/60">{String(entry.detail)}</span>}
                <span className="ml-auto text-xs text-slate-ink/45">{String(entry.actor)}</span>
              </summary>
              <div className="grid gap-3 border-t border-mist p-4 lg:grid-cols-2">
                {entry.documentId && <p className="text-xs lg:col-span-2"><span className="font-semibold">Documento:</span> <code>{String(entry.documentId)}</code></p>}
                {entry.filter && <p className="text-xs lg:col-span-2"><span className="font-semibold">Filtro:</span> <code className="break-all">{String(entry.filter)}</code></p>}
                {entry.update && <p className="text-xs lg:col-span-2"><span className="font-semibold">Atualização:</span> <code className="break-all">{String(entry.update)}</code></p>}
                {entry.before && <div><p className="mb-1 text-xs font-semibold">Antes</p><pre className="max-h-96 overflow-auto rounded-lg bg-night p-3 text-[11px] text-soft-jade">{toEjson(entry.before)}</pre></div>}
                {entry.after && <div><p className="mb-1 text-xs font-semibold">Depois</p><pre className="max-h-96 overflow-auto rounded-lg bg-night p-3 text-[11px] text-soft-jade">{toEjson(entry.after)}</pre></div>}
              </div>
            </details>
          </li>
        ))}
        {entries.length === 0 && <li className="rounded-xl border border-dashed border-mist p-10 text-center text-sm text-slate-ink/50">Nenhum registro.</li>}
      </ul>
      {total > PAGE_SIZE && (
        <nav className="mt-4 flex items-center justify-end gap-2 text-sm">
          {page > 1 && <Link href={pageHref(page - 1)} className="inline-flex h-9 items-center rounded-lg border border-mist bg-white px-3"><ChevronLeft className="h-4 w-4" /></Link>}
          <span className="text-slate-ink/60">Página {page} de {Math.ceil(total / PAGE_SIZE)}</span>
          {page * PAGE_SIZE < total && <Link href={pageHref(page + 1)} className="inline-flex h-9 items-center rounded-lg border border-mist bg-white px-3"><ChevronRight className="h-4 w-4" /></Link>}
        </nav>
      )}
    </>
  );
}
