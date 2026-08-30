import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-ink">
          Conta
        </h1>
        <p className="mt-1 text-sm text-stone">
          Dados da sua sessão autenticada.
        </p>
      </div>

      {/* Profile section */}
      <section className="rounded-2xl border border-mist bg-white">
        <div className="border-b border-mist px-6 py-4">
          <h2 className="font-heading text-sm font-semibold text-slate-ink">
            Perfil autenticado
          </h2>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-deep-teal to-forest-teal text-xl font-bold text-white shadow-md shadow-deep-teal/20">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold text-slate-ink">
                {session?.user?.name ?? "—"}
              </p>
              <p className="text-sm text-stone">
                {session?.user?.email ?? "—"}
              </p>
              <p className="mt-2 text-xs text-stone/70">
                Informações carregadas pelo servidor a partir da sessão atual.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
