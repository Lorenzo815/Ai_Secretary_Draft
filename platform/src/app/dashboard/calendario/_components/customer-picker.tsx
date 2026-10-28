"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import CustomerFormButton from "../../clientes/_components/customer-form-button";

export interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface CustomerPage {
  customers: CustomerOption[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export default function CustomerPicker({
  value,
  onChange,
}: {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CustomerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const parameters = new URLSearchParams({ mode: "customers", query: query.trim(), sort, page: String(page) });
        const response = await fetch(`/api/calendar?${parameters}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as Partial<CustomerPage> & { error?: string };
        if (!response.ok || !Array.isArray(data.customers) || typeof data.hasMore !== "boolean"
          || data.page !== page || !Number.isInteger(data.pageSize) || !data.pageSize || data.pageSize < 1) {
          throw new Error(data.error ?? "Não foi possível carregar os clientes.");
        }
        if (!controller.signal.aborted) {
          setResult({ customers: data.customers, page, pageSize: data.pageSize, hasMore: data.hasMore });
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os clientes.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, query, retry, sort]);

  const customers = result?.customers ?? [];
  const options = value && !customers.some((customer) => customer.id === value.id)
    ? [value, ...customers]
    : customers;

  function selectCreatedCustomer(customer: CustomerOption) {
    onChange(customer);
    setQuery("");
    setPage(1);
    setRetry((current) => current + 1);
  }

  return (
    <div>
      <span className="text-xs font-semibold text-slate-ink">Cliente</span>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="relative">
          <span className="sr-only">Pesquisar cliente por nome</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <input value={query} maxLength={160} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Pesquisar por nome" className="w-full rounded-lg border border-mist bg-white py-2.5 pl-9 pr-3 text-sm font-normal outline-none focus:border-deep-teal" />
        </label>
        <select value={sort} onChange={(event) => { setSort(event.target.value === "alphabetical" ? "alphabetical" : "recent"); setPage(1); }} aria-label="Ordenar clientes" className="rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal">
          <option value="recent">Recentes</option>
          <option value="alphabetical">A–Z</option>
        </select>
      </div>
      <label className="sr-only" htmlFor="calendar-customer">Selecionar cliente</label>
      <select id="calendar-customer" value={value?.id ?? ""} onChange={(event) => onChange(options.find((customer) => customer.id === event.target.value) ?? null)} disabled={loading || Boolean(error)} aria-busy={loading} className="mt-2 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal disabled:opacity-50">
        <option value="">Sem cliente</option>
        {options.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · +{customer.phone}</option>)}
      </select>
      {loading && <p className="mt-1.5 text-xs text-stone" role="status">Buscando clientes...</p>}
      {error && <p className="mt-1.5 text-xs text-burnt-coral" role="alert">{error} <button type="button" onClick={() => setRetry((current) => current + 1)} className="font-semibold underline">Tentar novamente</button></p>}
      {!loading && !error && result && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stone">
          <span role="status">{customers.length === 0 ? "Nenhum cliente encontrado." : `Exibindo ${(result.page - 1) * result.pageSize + 1}–${(result.page - 1) * result.pageSize + customers.length} clientes`}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => current - 1)} disabled={page === 1} className="font-semibold text-deep-teal disabled:opacity-40">Anterior</button>
            <span>Página {page}</span>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={!result.hasMore} className="font-semibold text-deep-teal disabled:opacity-40">Próxima</button>
          </div>
        </div>
      )}
      <div className="mt-2"><CustomerFormButton compact onCreated={selectCreatedCustomer} /></div>
    </div>
  );
}
