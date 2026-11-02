import Link from "next/link";
import { Database } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { listCollectionsInfo } from "@/lib/explorer";
import { formatBytes, formatNumber } from "@/lib/format";
import { PLATFORM_GLOBAL_COLLECTIONS } from "@/lib/platform-rules";

export const metadata = { title: "Dados" };

export default async function DataPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const collections = (await listCollectionsInfo()).filter((collection) => collection.name.includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title="Dados" description="Todas as coleções do MongoDB. Abra uma coleção para filtrar, ver, editar, criar ou excluir documentos. Segredos aparecem mascarados e toda alteração fica na Auditoria." />
      <form method="get" className="mb-4"><input name="q" defaultValue={q} placeholder="Filtrar coleções" className="h-10 w-72 rounded-lg border border-mist bg-white px-3 text-sm" /></form>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {collections.map((collection) => (
          <Link key={collection.name} href={`/data/${collection.name}`}
            className="group rounded-2xl border border-mist bg-white p-4 shadow-sm transition hover:border-deep-teal/40 hover:shadow">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-mono text-sm font-semibold text-slate-ink group-hover:text-deep-teal">
                <Database className="h-4 w-4 text-deep-teal" />{collection.name}
              </span>
              {PLATFORM_GLOBAL_COLLECTIONS.has(collection.name) && <Badge tone="dark">Global</Badge>}
              {collection.name === "backoffice_audit" && <Badge tone="teal">Auditoria</Badge>}
            </div>
            <div className="mt-3 flex justify-between text-xs text-slate-ink/60">
              <span><strong className="font-semibold text-slate-ink">{formatNumber(collection.count)}</strong> documentos</span>
              <span>{formatBytes(collection.storageBytes)}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
