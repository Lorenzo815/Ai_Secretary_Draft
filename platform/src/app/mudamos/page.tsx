import type { Metadata } from "next";
import { OriaSymbol } from "@/components/oria-logo";
import { MOVED_TO_ORIGIN, movedTargetUrl } from "@/lib/moved-notice";

export const metadata: Metadata = {
  title: "A Oria tem um novo endereço",
  robots: { index: false, follow: false },
};

const steps = [
  { title: "Entre com o mesmo e-mail e senha", text: "Por segurança, o acesso é feito novamente no novo endereço." },
  { title: "Atualize seus favoritos", text: "Salve o novo endereço no navegador para os próximos acessos." },
  { title: "Usa a Oria instalada no celular ou computador?", text: "Abra o novo endereço e instale o aplicativo outra vez." },
];

export default async function MovedPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const target = movedTargetUrl((await searchParams).from);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-soft-ivory px-5 py-12">
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-deep-teal/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-soft-jade/20 blur-3xl" />

      <section className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-mist bg-white shadow-xl shadow-deep-teal/5">
        <div className="bg-deep-teal px-8 pb-10 pt-8 text-white sm:px-10">
          <div className="flex items-center gap-3">
            <OriaSymbol className="h-8 w-8" color="#FCFAF6" />
            <span className="font-heading text-xl font-semibold tracking-tight text-white/95">Oria</span>
          </div>
          <span className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-soft-jade" />
            Novo endereço
          </span>
          <h1 className="mt-4 font-heading text-3xl font-semibold leading-tight sm:text-4xl">
            A Oria mudou de casa
          </h1>
          <p className="mt-3 text-base leading-relaxed text-white/85">
            Agora estamos em uma estrutura nova, mais rápida e preparada para crescer junto com a sua clínica.
            Pacientes, conversas, agenda e configurações continuam exatamente como estavam.
          </p>
        </div>

        <div className="px-8 py-8 sm:px-10">
          <a
            href={target}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-deep-teal px-6 text-base font-semibold text-white shadow-md shadow-deep-teal/20 transition hover:bg-forest-teal focus:outline-none focus-visible:ring-4 focus-visible:ring-deep-teal/30"
          >
            Abrir a nova Oria
            <span aria-hidden>→</span>
          </a>
          <p className="mt-3 text-center text-xs text-stone">
            Novo endereço: <span className="select-all break-all font-medium text-slate-ink">{MOVED_TO_ORIGIN}</span>
          </p>

          <ol className="mt-8 space-y-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warm-sand text-sm font-semibold text-deep-teal">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-ink">{step.title}</p>
                  <p className="mt-0.5 text-sm text-slate-ink/70">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 rounded-xl bg-soft-ivory px-4 py-3 text-sm text-slate-ink/80">
            O atendimento automático pelo WhatsApp continua funcionando normalmente durante a mudança.
          </div>
        </div>
      </section>
    </main>
  );
}
