import { OriaLogo } from "@/components/oria-logo";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-soft-ivory px-6">
      <section className="w-full max-w-md text-center">
        <OriaLogo className="justify-center" size="large" />
        <p className="mt-10 text-xs font-semibold uppercase text-deep-teal">Sem conexão</p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">A Oria está offline</h1>
        <p className="mt-3 text-sm leading-6 text-stone">Verifique sua conexão para acessar clientes, agenda e conversas com dados atualizados.</p>
        <a href="/dashboard" className="mt-7 inline-flex rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal">Tentar novamente</a>
      </section>
    </main>
  );
}
