import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({
  pathname,
  page,
  pageCount,
  pageSize,
  total,
  parameters = {},
}: {
  pathname: string;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  parameters?: Record<string, string | undefined>;
}) {
  if (total === 0) return null;
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  function href(targetPage: number) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) {
      if (value) search.set(key, value);
    }
    if (targetPage > 1) search.set("page", String(targetPage));
    return `${pathname}${search.size ? `?${search}` : ""}`;
  }

  return (
    <nav aria-label="Paginação" className="flex flex-col gap-3 border-t border-mist px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="text-xs font-medium text-stone">Exibindo <span className="font-semibold text-slate-ink">{firstItem}–{lastItem}</span> de <span className="font-semibold text-slate-ink">{total}</span></p>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link href={href(page - 1)} aria-label="Página anterior" className="inline-flex h-9 items-center gap-1 rounded-md border border-mist bg-white px-3 text-xs font-semibold text-slate-ink hover:border-stone"><ChevronLeft className="h-4 w-4" />Anterior</Link> : <span aria-disabled="true" className="inline-flex h-9 items-center gap-1 rounded-md border border-mist px-3 text-xs font-semibold text-stone opacity-50"><ChevronLeft className="h-4 w-4" />Anterior</span>}
        <span className="min-w-20 text-center text-xs font-semibold text-stone">{page} de {pageCount}</span>
        {page < pageCount ? <Link href={href(page + 1)} aria-label="Próxima página" className="inline-flex h-9 items-center gap-1 rounded-md border border-mist bg-white px-3 text-xs font-semibold text-slate-ink hover:border-stone">Próxima<ChevronRight className="h-4 w-4" /></Link> : <span aria-disabled="true" className="inline-flex h-9 items-center gap-1 rounded-md border border-mist px-3 text-xs font-semibold text-stone opacity-50">Próxima<ChevronRight className="h-4 w-4" /></span>}
      </div>
    </nav>
  );
}