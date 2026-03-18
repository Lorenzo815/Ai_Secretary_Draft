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
          Configurações
        </h1>
        <p className="mt-1 text-sm text-stone">
          Gerencie seu perfil e preferências da plataforma.
        </p>
      </div>

      {/* Profile section */}
      <section className="rounded-2xl border border-mist bg-white">
        <div className="border-b border-mist px-6 py-4">
          <h2 className="font-heading text-sm font-semibold text-slate-ink">
            Perfil
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
            </div>
          </div>
        </div>
      </section>

      {/* Account section */}
      <section className="rounded-2xl border border-mist bg-white">
        <div className="border-b border-mist px-6 py-4">
          <h2 className="font-heading text-sm font-semibold text-slate-ink">
            Conta
          </h2>
        </div>
        <div className="divide-y divide-mist/60">
          <SettingsRow label="Nome" value={session?.user?.name ?? "—"} />
          <SettingsRow label="Email" value={session?.user?.email ?? "—"} />
          <SettingsRow label="Plano" value="Starter" badge />
          <SettingsRow label="Senha" value="••••••••" />
        </div>
      </section>

      {/* Preferences section */}
      <section className="rounded-2xl border border-mist bg-white">
        <div className="border-b border-mist px-6 py-4">
          <h2 className="font-heading text-sm font-semibold text-slate-ink">
            Preferências
          </h2>
        </div>
        <div className="divide-y divide-mist/60">
          <SettingsRow label="Idioma" value="Português (BR)" />
          <SettingsRow label="Fuso horário" value="America/Sao_Paulo" />
          <SettingsRow label="Notificações por email" value="Ativadas" />
        </div>
      </section>
    </div>
  );
}

function SettingsRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <span className="text-sm font-medium text-stone">{label}</span>
      <div className="flex items-center gap-2">
        {badge ? (
          <span className="rounded-full bg-deep-teal/10 px-3 py-0.5 text-xs font-semibold text-deep-teal">
            {value}
          </span>
        ) : (
          <span className="text-sm text-slate-ink">{value}</span>
        )}
      </div>
    </div>
  );
}
