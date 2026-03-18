export default function RelatoriosPage() {
  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-ink">
          Relatórios
        </h1>
        <p className="mt-1 text-sm text-stone">
          Acompanhe métricas e desempenho da operação.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-mist bg-white py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warm-sand">
          <svg className="h-7 w-7 text-stone" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-slate-ink/60">
          Em breve
        </p>
        <p className="mt-1 max-w-xs text-xs text-stone">
          Dashboards, exportações e insights sobre suas conversas e custos.
        </p>
      </div>
    </div>
  );
}
