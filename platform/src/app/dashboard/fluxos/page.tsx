export default function FluxosPage() {
  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-ink">
          Fluxos
        </h1>
        <p className="mt-1 text-sm text-stone">
          Crie e gerencie seus fluxos conversacionais.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-mist bg-white py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warm-sand">
          <svg className="h-7 w-7 text-stone" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-slate-ink/60">
          Em breve
        </p>
        <p className="mt-1 max-w-xs text-xs text-stone">
          Monte fluxos visuais de atendimento com IA, templates e lógica condicional.
        </p>
      </div>
    </div>
  );
}
