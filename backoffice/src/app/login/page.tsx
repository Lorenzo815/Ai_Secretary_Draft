import type { Metadata } from "next";
import { totpConfigured } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = totpConfigured();
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-night px-6">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-deep-teal/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-soft-jade/10 blur-3xl" />
      <section className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-white shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-soft-jade/15 text-soft-jade">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 4a8 8 0 1 0 8 8" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div>
            <p className="font-heading text-lg font-semibold leading-tight">Oria Backoffice</p>
            <p className="text-xs text-white/50">Acesso restrito à equipe Oria</p>
          </div>
        </div>
        <h1 className="mt-8 font-heading text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-white/60">Digite o código de 6 dígitos do Google Authenticator.</p>
        {configured ? <LoginForm /> : (
          <p className="mt-6 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
            O acesso ainda não foi configurado.
            {process.env.NODE_ENV === "development" && <> Abra <a href="/setup" className="font-semibold underline">/setup</a> para configurar o aplicativo.</>}
          </p>
        )}
      </section>
    </main>
  );
}
