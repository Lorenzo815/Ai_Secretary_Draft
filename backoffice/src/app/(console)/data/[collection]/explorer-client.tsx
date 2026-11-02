"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, FilePlus2, Layers, Lock, Save, Trash2, X } from "lucide-react";
import { useGuardedAction } from "@/components/guarded-action";
import { Badge, buttonClass, dangerButtonClass, secondaryButtonClass } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MASK } from "@/lib/masking";
import {
  bulkWriteAction, deleteDocumentAction, getDocumentAction, insertDocumentAction, previewBulkAction, revealFieldAction, saveDocumentAction,
} from "../../actions";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Row { id: string; json: string }
interface Query { company?: string; filter?: string; id?: string }

function getField(document: Json, path: string): Json | undefined {
  let current: Json | undefined = document;
  for (const part of path.split(".")) {
    if (current && typeof current === "object" && !Array.isArray(current)) current = current[part];
    else if (Array.isArray(current)) current = current[Number(part)];
    else return undefined;
  }
  return current;
}

function Cell({ value, column, companyNames }: { value: Json | undefined; column: string; companyNames: Record<string, string> }) {
  if (value === undefined) return <span className="text-slate-ink/25">—</span>;
  if (value === null) return <span className="text-slate-ink/40">null</span>;
  if (typeof value === "boolean") return <Badge tone={value ? "teal" : "gray"}>{String(value)}</Badge>;
  if (typeof value === "number") return <span className="tabular-nums">{value}</span>;
  if (typeof value === "string") return <span title={value}>{value.length > 70 ? `${value.slice(0, 70)}…` : value}</span>;
  if (Array.isArray(value)) return <span className="text-slate-ink/50">[{value.length} itens]</span>;
  if ("$oid" in value) {
    const id = String(value.$oid);
    if (column === "companyId" || column === "_id" && companyNames[id]) {
      return <span title={id}><Badge tone="teal">{companyNames[id] ?? `${id.slice(0, 6)}…`}</Badge></span>;
    }
    return <span className="font-mono text-xs" title={id}>{id.slice(0, 8)}…{id.slice(-4)}</span>;
  }
  if ("$date" in value) return <span className="whitespace-nowrap text-xs">{formatDate(typeof value.$date === "object" && value.$date && "$numberLong" in value.$date ? Number(value.$date.$numberLong) : value.$date as string)}</span>;
  if (MASK in value) return <span className="inline-flex items-center gap-1 text-xs text-slate-ink/50"><Lock className="h-3 w-3" />protegido</span>;
  if ("$numberLong" in value || "$numberDecimal" in value) return <span className="tabular-nums">{String(Object.values(value)[0])}</span>;
  const keys = Object.keys(value);
  return <span className="font-mono text-xs text-slate-ink/50">{`{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`}</span>;
}

export function ExplorerTable({ collection, columns, rows, companyNames }: {
  collection: string; columns: string[]; rows: Row[]; companyNames: Record<string, string>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const parsed = rows.map((row) => ({ id: row.id, value: JSON.parse(row.json) as Json }));
  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-mist bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-soft-ivory text-left text-[11px] uppercase tracking-wide text-slate-ink/50">
            <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold normal-case">{column}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-mist">
            {parsed.map((row) => (
              <tr key={row.id} onClick={() => setOpenId(row.id)} className="cursor-pointer hover:bg-deep-teal/[0.04]">
                {columns.map((column) => (
                  <td key={column} className="max-w-xs truncate px-4 py-2.5 align-top">
                    <Cell value={getField(row.value, column)} column={column} companyNames={companyNames} />
                  </td>
                ))}
              </tr>
            ))}
            {parsed.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-ink/50">Nenhum documento encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      {openId && <DocumentDrawer collection={collection} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function DocumentDrawer({ collection, id, onClose }: { collection: string; id: string; onClose: () => void }) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [state, setState] = useState<{ json: string; production: boolean; masks: Array<{ path: string; kind: string; revealable: boolean }> } | null>(null);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getDocumentAction(collection, id).then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.ok) { setState(result.data); setText(result.data.json); } else setLoadError(result.error);
    });
    return () => { active = false; };
  }, [collection, id]);
  const dirty = state !== null && text !== state.json;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-night/30 backdrop-blur-[1px]" onClick={onClose}>
      {ui}
      <aside className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-mist px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-ink/50">{collection}</p>
            <p className="truncate font-mono text-sm font-semibold">{id}</p>
            {state?.production && <p className="mt-1"><Badge tone="dark">Clínica em produção</Badge></p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 hover:bg-stone-100"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          {loading && <p className="text-sm text-slate-ink/50">Carregando…</p>}
          {loadError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
          {state && (
            <>
              {state.masks.length > 0 && (
                <div className="rounded-xl border border-mist bg-soft-ivory/70 p-3">
                  <p className="text-xs font-semibold text-slate-ink/70">Campos protegidos (mantidos ao salvar; para trocar, substitua o marcador por um valor novo)</p>
                  <ul className="mt-2 space-y-1.5">
                    {state.masks.map((mask) => (
                      <li key={mask.path} className="flex flex-wrap items-center gap-2 text-xs">
                        <Lock className="h-3 w-3 text-slate-ink/40" /><code className="font-mono">{mask.path}</code><Badge>{mask.kind}</Badge>
                        {revealed[mask.path] !== undefined ? (
                          <code className="break-all rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-900">{revealed[mask.path]}</code>
                        ) : mask.revealable ? (
                          <button type="button" disabled={pending} className="inline-flex items-center gap-1 font-semibold text-deep-teal hover:underline"
                            onClick={() => run(() => revealFieldAction(collection, id, mask.path), {
                              success: "Valor revelado (registrado na auditoria).",
                              onSuccess: (plain) => setRevealed((current) => ({ ...current, [mask.path]: plain })),
                            })}><Eye className="h-3 w-3" />Revelar</button>
                        ) : <span className="text-slate-ink/40">não pode ser revelado</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false}
                className="min-h-[50vh] flex-1 rounded-xl border border-mist bg-night p-4 font-mono text-xs leading-relaxed text-soft-jade outline-none focus:border-deep-teal" />
              <p className="text-xs text-slate-ink/50">Extended JSON: <code>{"{\"$oid\": …}"}</code> para ObjectId e <code>{"{\"$date\": …}"}</code> para datas. O <code>_id</code> não pode mudar.</p>
            </>
          )}
        </div>
        {state && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-mist px-5 py-3">
            <button type="button" disabled={pending} className={dangerButtonClass}
              onClick={() => run((confirmation) => deleteDocumentAction(collection, id, confirmation), { onSuccess: () => { onClose(); router.refresh(); } })}>
              <Trash2 className="h-4 w-4" />Excluir
            </button>
            <div className="flex gap-2">
              {dirty && <button type="button" onClick={() => setText(state.json)} className={secondaryButtonClass}>Descartar</button>}
              <button type="button" disabled={pending || !dirty} className={buttonClass}
                onClick={() => run((confirmation) => saveDocumentAction(collection, id, text, confirmation), {
                  onSuccess: () => { setState({ ...state, json: text }); router.refresh(); },
                })}>
                <Save className="h-4 w-4" />Salvar
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}

export function ExplorerToolbar({ collection, query, total, defaultCompanyId }: { collection: string; query: Query; total: number; defaultCompanyId?: string }) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [panel, setPanel] = useState<"none" | "insert" | "bulk">("none");
  const [insertText, setInsertText] = useState(defaultCompanyId ? `{\n  "companyId": { "$oid": "${defaultCompanyId}" }\n}` : "{\n  \n}");
  const [updateText, setUpdateText] = useState('{\n  "$set": { }\n}');
  const [preview, setPreview] = useState<{ count: number; production: number } | null>(null);
  const filterSummary = [query.company && `clínica ${query.company}`, query.id && `_id ${query.id}`, query.filter].filter(Boolean).join(" · ") || "sem filtro (TODA a coleção)";

  return (
    <div className="mb-4">
      {ui}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPanel(panel === "insert" ? "none" : "insert")} className={secondaryButtonClass}><FilePlus2 className="h-4 w-4" />Novo documento</button>
        <button type="button" onClick={() => { setPreview(null); setPanel(panel === "bulk" ? "none" : "bulk"); }} className={secondaryButtonClass}><Layers className="h-4 w-4" />Ações em massa</button>
      </div>
      {panel === "insert" && (
        <div className="mt-3 rounded-2xl border border-mist bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold">Novo documento em <code>{collection}</code></p>
          <textarea value={insertText} onChange={(event) => setInsertText(event.target.value)} rows={10} spellCheck={false}
            className="mt-2 w-full rounded-xl border border-mist bg-night p-3 font-mono text-xs text-soft-jade outline-none" />
          <div className="mt-2 flex justify-end">
            <button type="button" disabled={pending} className={buttonClass}
              onClick={() => run((confirmation) => insertDocumentAction(collection, insertText, confirmation), { onSuccess: () => { setPanel("none"); router.refresh(); } })}>
              Criar documento
            </button>
          </div>
        </div>
      )}
      {panel === "bulk" && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold text-amber-900">Ações em massa sobre o filtro atual</p>
          <p className="mt-1 font-mono text-xs text-amber-900/80">{filterSummary}</p>
          <p className="mt-1 text-xs text-amber-900/70">Mostrando {total} documento(s). Será pedido para digitar a quantidade exata para confirmar.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} className={secondaryButtonClass}
              onClick={() => run(() => previewBulkAction({ collection, ...query }), { success: "Contagem atualizada.", onSuccess: setPreview })}>Contar afetados</button>
            {preview && <span className="text-sm">{preview.count} documento(s){preview.production > 0 && <strong className="text-red-700"> · {preview.production} da clínica em produção</strong>}</span>}
          </div>
          <label className="mt-3 block text-xs font-semibold text-amber-900">Atualização (operadores como $set/$unset/$inc, ou pipeline)</label>
          <textarea value={updateText} onChange={(event) => setUpdateText(event.target.value)} rows={5} spellCheck={false}
            className="mt-1 w-full rounded-xl border border-mist bg-night p-3 font-mono text-xs text-soft-jade outline-none" />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={pending} className={dangerButtonClass}
              onClick={() => run((confirmation) => bulkWriteAction({ collection, ...query, operation: "bulk-delete" }, confirmation), {
                success: "Documentos excluídos.", onSuccess: () => { setPanel("none"); router.refresh(); },
              })}><Trash2 className="h-4 w-4" />Excluir todos do filtro</button>
            <button type="button" disabled={pending} className={buttonClass}
              onClick={() => run((confirmation) => bulkWriteAction({ collection, ...query, operation: "bulk-update", update: updateText }, confirmation), {
                success: "Documentos atualizados.", onSuccess: () => { setPanel("none"); router.refresh(); },
              })}>Atualizar todos do filtro</button>
          </div>
        </div>
      )}
    </div>
  );
}
