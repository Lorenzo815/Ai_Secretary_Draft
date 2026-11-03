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
      {/* Same columns and units as the MongoDB Atlas collection list. */}
      <div className="overflow-x-auto rounded-2xl border border-mist bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-soft-ivory text-left text-xs uppercase tracking-wide text-slate-ink/50">
            <tr>
              <th className="px-4 py-2.5">Collection name</th>
              <th className="px-3 text-right">Storage size</th>
              <th className="px-3 text-right">Data size</th>
              <th className="px-3 text-right">Documents</th>
              <th className="px-3 text-right">Avg. document size</th>
              <th className="px-3 text-right">Indexes</th>
              <th className="px-4 text-right">Total index size</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mist">
            {collections.map((collection) => (
              <tr key={collection.name} className="hover:bg-soft-ivory/60">
                <td className="px-4 py-2.5">
                  <Link href={`/data/${collection.name}`} className="inline-flex items-center gap-2 font-mono font-semibold text-slate-ink hover:text-deep-teal">
                    <Database className="h-4 w-4 text-deep-teal" />{collection.name}
                  </Link>
                  {PLATFORM_GLOBAL_COLLECTIONS.has(collection.name) && <span className="ml-2"><Badge tone="dark">Global</Badge></span>}
                  {collection.name === "backoffice_audit" && <span className="ml-2"><Badge tone="teal">Auditoria</Badge></span>}
                </td>
                <td className="px-3 text-right tabular-nums">{formatBytes(collection.storageBytes)}</td>
                <td className="px-3 text-right tabular-nums">{formatBytes(collection.dataBytes)}</td>
                <td className="px-3 text-right tabular-nums">{formatNumber(collection.count)}</td>
                <td className="px-3 text-right tabular-nums">{formatBytes(collection.avgDocumentBytes)}</td>
                <td className="px-3 text-right tabular-nums">{collection.indexCount}</td>
                <td className="px-4 text-right tabular-nums">{formatBytes(collection.indexBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
