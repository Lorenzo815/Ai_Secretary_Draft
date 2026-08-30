import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";

const mvpCapabilities = [
  {
    title: "Agendamento inicial",
    description:
      "Organizar horários disponíveis e confirmar o primeiro atendimento pelo WhatsApp.",
    status: "Próxima entrega",
  },
  {
    title: "Acompanhamentos",
    description:
      "Lembrar clientes e enviar retornos após o atendimento, com revisão humana quando necessário.",
    status: "Planejado",
  },
];

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const firstName = session?.user?.name?.split(" ")[0] ?? "Usuário";

  return (
    <div className="animate-fade-in-up space-y-8">
      <header className="border-b border-mist pb-6">
        <p className="text-sm font-medium text-deep-teal">Visão geral</p>
        <h1 className="font-heading text-2xl font-bold text-slate-ink">
          Olá, {firstName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">
          A Oria está na fase inicial. Hoje, o acesso à conta já funciona; as
          automações abaixo definem o escopo da primeira versão operacional.
        </p>
      </header>

      <section aria-labelledby="mvp-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="mvp-title" className="font-heading text-lg font-semibold text-slate-ink">
              Foco do MVP
            </h2>
            <p className="mt-1 text-sm text-stone">
              Uma agenda simples e retornos pelo WhatsApp.
            </p>
          </div>
          <span className="rounded-full border border-deep-teal/20 bg-deep-teal/5 px-3 py-1 text-xs font-semibold text-deep-teal">
            Em desenvolvimento
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {mvpCapabilities.map((capability, index) => (
            <article key={capability.title} className="rounded-lg border border-mist bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-deep-teal text-sm font-bold text-white">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold text-stone">{capability.status}</span>
              </div>
              <h3 className="mt-5 font-heading text-base font-semibold text-slate-ink">
                {capability.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone">{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="integration-title" className="border-t border-mist pt-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h2 id="integration-title" className="font-heading text-base font-semibold text-slate-ink">
              Integração com WhatsApp
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone">
              Consulte o estado da conexão, teste o envio de mensagens e
              acompanhe o histórico recebido pelo webhook.
            </p>
          </div>
          <Link
            href="/dashboard/whatsapp"
            className="w-fit rounded-lg border border-deep-teal/20 px-3 py-2 text-sm font-semibold text-deep-teal transition-colors hover:bg-deep-teal/5"
          >
            Abrir integração
          </Link>
        </div>
      </section>

      <aside className="rounded-lg border border-mist bg-warm-sand/50 px-5 py-4 text-sm text-slate-ink/70">
        Pagamentos via PIX ficam fora deste MVP e serão avaliados depois que o
        fluxo de agendamento e acompanhamento estiver validado.
      </aside>
    </div>
  );
}
