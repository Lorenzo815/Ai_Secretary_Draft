import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader, inputClass, labelClass } from "@/components/ui";
import { toEjson } from "@/lib/actions";
import { assertCollection, companyNames, queryCollection } from "@/lib/explorer";
import { formatNumber } from "@/lib/format";
import { ExplorerTable, ExplorerToolbar } from "./explorer-client";

type Search = { company?: string; filter?: string; id?: string; sort?: string; dir?: string; page?: string; size?: string; cols?: string };

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }) {
  return { title: (await params).collection };
}

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ collection: string }>; searchParams: Promise<Search> }) {
  const { collection } = await params;
  const search = await searchParams;
  try { await assertCollection(collection); } catch { notFound(); }
  const names = await companyNames();
  let error = "";
  let result: Awaited<ReturnType<typeof queryCollection>> | null = null;
  try {
    result = await queryCollection({
      collection, company: search.company, filter: search.filter, id: search.id, sort: search.sort,
      dir: search.dir === "asc" ? "asc" : "desc", page: Number(search.page ?? 1), size: Number(search.size ?? 25),
    });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Falha na consulta.";
  }

  const rows = result?.rows ?? [];
  const frequency = new Map<string, number>();
  for (const row of rows) for (const key of Object.keys(row)) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  const requested = search.cols?.split(",").map((col) => col.trim()).filter(Boolean);
  const columns = requested?.length ? ["_id", ...requested.filter((col) => col !== "_id")]
    : ["_id", ...(frequency.has("companyId") ? ["companyId"] : []),
      ...[...frequency.entries()].filter(([key]) => key !== "_id" && key !== "companyId").sort((a, b) => b[1] - a[1]).slice(0, 7).map(([key]) => key)];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.size)) : 1;
  const pageHref = (page: number) => {
    const next = new URLSearchParams(Object.entries(search).filter(([, value]) => value) as [string, string][]);
    next.set("page", String(page));
    return `?${next.toString()}`;
  };

  return (
    <>
      <Link href="/data" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-ink/60 hover:text-deep-teal"><ArrowLeft className="h-4 w-4" />Coleções</Link>
      <PageHeader title={collection} description={result ? `${formatNumber(result.total)} documento(s) com os filtros atuais.` : undefined} />

      <form method="get" className="mb-4 grid gap-3 rounded-2xl border border-mist bg-white p-4 shadow-sm lg:grid-cols-12">
        <label className="lg:col-span-3"><span className={labelClass}>Clínica</span>
          <select name="company" defaultValue={search.company ?? ""} className={`${inputClass} mt-1`}>
            <option value="">Todas</option>
            {[...names.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            <option value="none">Sem companyId</option>
          </select>
        </label>
        <label className="lg:col-span-3"><span className={labelClass}>_id</span><input name="id" defaultValue={search.id} placeholder="ObjectId ou texto" className={`${inputClass} mt-1 font-mono`} /></label>
        <label className="lg:col-span-2"><span className={labelClass}>Ordenar por</span><input name="sort" defaultValue={search.sort ?? "_id"} className={`${inputClass} mt-1 font-mono`} /></label>
        <label className="lg:col-span-2"><span className={labelClass}>Direção</span>
          <select name="dir" defaultValue={search.dir ?? "desc"} className={`${inputClass} mt-1`}><option value="desc">Decrescente</option><option value="asc">Crescente</option></select>
        </label>
        <label className="lg:col-span-2"><span className={labelClass}>Por página</span>
          <select name="size" defaultValue={search.size ?? "25"} className={`${inputClass} mt-1`}>{[10, 25, 50, 100, 200].map((size) => <option key={size}>{size}</option>)}</select>
        </label>
        <label className="lg:col-span-8"><span className={labelClass}>Filtro (Extended JSON do MongoDB)</span>
          <input name="filter" defaultValue={search.filter} placeholder='{"status": "scheduled", "startAt": {"$gte": {"$date": "2026-11-01T00:00:00Z"}}}' className={`${inputClass} mt-1 font-mono text-xs`} />
        </label>
        <label className="lg:col-span-3"><span className={labelClass}>Colunas (opcional, separadas por vírgula)</span><input name="cols" defaultValue={search.cols} placeholder="name, status, updatedAt" className={`${inputClass} mt-1 font-mono text-xs`} /></label>
        <div className="flex items-end lg:col-span-1"><button className="h-10 w-full rounded-lg bg-slate-ink px-3 text-sm font-semibold text-white hover:bg-night">Aplicar</button></div>
      </form>

      <ExplorerToolbar collection={collection} query={{ company: search.company, filter: search.filter, id: search.id }} total={result?.total ?? 0}
        defaultCompanyId={search.company && search.company !== "none" ? search.company : undefined} />

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : (
        <ExplorerTable collection={collection} columns={columns} companyNames={Object.fromEntries(names)}
          rows={rows.map((row) => ({ id: toEjson(row._id, false), json: toEjson(row, false) }))} />
      )}

      {result && totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-end gap-2 text-sm">
          {result.page > 1 && <Link href={pageHref(result.page - 1)} className="inline-flex h-9 items-center rounded-lg border border-mist bg-white px-3"><ChevronLeft className="h-4 w-4" /></Link>}
          <span className="text-slate-ink/60">Página {result.page} de {formatNumber(totalPages)}</span>
          {result.page < totalPages && <Link href={pageHref(result.page + 1)} className="inline-flex h-9 items-center rounded-lg border border-mist bg-white px-3"><ChevronRight className="h-4 w-4" /></Link>}
        </nav>
      )}
    </>
  );
}
