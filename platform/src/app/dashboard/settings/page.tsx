import { getServerSession } from "next-auth";
import Link from "next/link";
import { ArrowRight, KeyRound, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { authOptions } from "@/lib/auth";
import AutoRefresh from "../_components/auto-refresh";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <div className="animate-fade-in-up space-y-8">
      <AutoRefresh />
      <header className="border-b border-mist pb-5">
        <p className="text-sm font-semibold text-deep-teal">Identidade e acesso</p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Minha conta</h1>
        <p className="mt-2 text-sm text-stone">Dados da sessão atual e escopo de acesso à operação.</p>
      </header>

      <section className="overflow-hidden rounded-lg border border-mist bg-white">
        <div className="border-b border-mist px-6 py-4">
          <h2 className="font-heading text-sm font-semibold text-slate-ink">
            Perfil autenticado
          </h2>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-deep-teal text-xl font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold text-slate-ink">
                {session?.user?.name ?? "—"}
              </p>
              <p className="text-sm text-stone">
                {session?.user?.email ?? "—"}
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-deep-teal"><ShieldCheck className="h-3.5 w-3.5" />Sessão autenticada</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="access-title" className="grid gap-5 border-y border-mist py-6 lg:grid-cols-[1fr_1.2fr]">
        <div><p className="text-[11px] font-semibold uppercase text-deep-teal">Segurança</p><h2 id="access-title" className="mt-1 font-heading text-base font-semibold text-slate-ink">Sessão e credenciais</h2><p className="mt-2 max-w-md text-sm leading-6 text-stone">O acesso administrativo é protegido em todas as páginas e APIs do dashboard.</p></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <AccessDetail icon={KeyRound} label="Método" value="Email e senha" />
          <AccessDetail icon={ShieldCheck} label="Duração" value="24 horas" />
          <AccessDetail icon={ShieldCheck} label="Escopo" value="Dashboard completo" />
        </div>
      </section>

      <Link href="/dashboard/settings/system" className="group flex items-center justify-between gap-5 rounded-lg border border-mist bg-white p-5 transition hover:border-deep-teal/40"><div className="flex items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><SlidersHorizontal className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-slate-ink">Configurações do sistema</p><p className="mt-1 text-xs leading-5 text-stone">Gerencie Pix, disponibilidade do agente e limpeza de dados operacionais.</p></div></div><ArrowRight className="h-4 w-4 shrink-0 text-stone transition group-hover:translate-x-0.5 group-hover:text-deep-teal" /></Link>
    </div>
  );
}

function AccessDetail({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div className="rounded-md bg-white p-4 ring-1 ring-mist">
      <Icon className="mb-3 h-4 w-4 text-deep-teal" />
      <p className="text-xs font-semibold uppercase text-stone">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-ink">{value}</p>
    </div>
  );
}
