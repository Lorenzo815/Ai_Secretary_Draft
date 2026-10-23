import Link from "next/link";

export default function AccessDeniedPage() {
  return <section className="space-y-4 rounded-lg border border-mist bg-white p-6">
    <h1 className="font-heading text-xl font-semibold text-slate-ink">Acesso não permitido</h1>
    <p className="text-sm text-stone">Esta página exige permissões que não foram concedidas à sua conta. Solicite acesso ao administrador da empresa.</p>
    <Link href="/dashboard/settings" className="text-sm font-semibold text-deep-teal">Minha conta e empresa</Link>
  </section>;
}
