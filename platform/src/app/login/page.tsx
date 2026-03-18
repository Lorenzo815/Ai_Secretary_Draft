"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { OriaLogo, OriaSymbol } from "@/components/oria-logo";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email ou senha inválidos.");
    } else if (result?.ok) {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Brand Panel ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[560px] flex-col justify-between bg-gradient-to-br from-deep-teal to-forest-teal p-12 relative overflow-hidden">
        {/* Decorative orbital rings */}
        <div className="pointer-events-none absolute -right-24 -top-24 opacity-[0.07]">
          <OriaSymbol className="h-[400px] w-[400px] animate-orbital" color="#FCFAF6" />
        </div>
        <div className="pointer-events-none absolute -bottom-32 -left-20 opacity-[0.05]">
          <OriaSymbol className="h-[300px] w-[300px] animate-orbital" color="#6EE7B7" />
        </div>

        {/* Top: logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <OriaSymbol className="h-9 w-9" color="#FCFAF6" />
            <span className="font-heading text-2xl font-semibold text-white/95 tracking-tight">
              Oria
            </span>
          </div>
        </div>

        {/* Center: value prop */}
        <div className="relative z-10 space-y-6">
          <h2 className="font-heading text-3xl font-bold leading-tight text-white">
            Operação conversacional
            <br />
            com IA, sob controle.
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-white/70">
            Automatize atendimento, controle custos por conversa e escale
            sua operação com inteligência — tudo em uma plataforma.
          </p>

          {/* Trust indicators */}
          <div className="flex gap-6 pt-4">
            <div className="space-y-1">
              <div className="text-2xl font-bold text-soft-jade">100%</div>
              <div className="text-xs text-white/50">Transparência de custos</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-soft-jade">&lt;10min</div>
              <div className="text-xs text-white/50">Setup inicial</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl font-bold text-soft-jade">Multi-LLM</div>
              <div className="text-xs text-white/50">Flexibilidade total</div>
            </div>
          </div>
        </div>

        {/* Bottom: copyright */}
        <div className="relative z-10">
          <p className="text-xs text-white/30">
            © {new Date().getFullYear()} Oria. Todos os direitos reservados.
          </p>
        </div>
      </div>

      {/* ── Form Panel ── */}
      <div className="flex flex-1 items-center justify-center bg-soft-ivory px-6">
        <div className="pointer-events-none fixed inset-0 lg:hidden bg-gradient-to-b from-soft-ivory to-warm-sand" />

        <div className="animate-fade-in-up relative w-full max-w-[400px] space-y-8">
          {/* Mobile logo */}
          <div className="flex flex-col items-center gap-3 lg:hidden">
            <OriaLogo size="large" />
          </div>

          {/* Heading */}
          <div className="hidden lg:block">
            <h1 className="font-heading text-2xl font-bold text-slate-ink">
              Bem-vindo de volta
            </h1>
            <p className="mt-1.5 text-sm text-stone">
              Entre na sua conta para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-burnt-coral/20 bg-burnt-coral/5 px-4 py-3 text-sm text-burnt-coral">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-ink">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="mt-1.5 block w-full rounded-xl border border-mist bg-white px-4 py-3 text-sm text-slate-ink placeholder-stone shadow-sm focus:border-deep-teal focus:outline-none focus:ring-2 focus:ring-deep-teal/20 transition-all"
                  placeholder="voce@empresa.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-ink">
                  Senha
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    minLength={8}
                    className="block w-full rounded-xl border border-mist bg-white px-4 py-3 pr-11 text-sm text-slate-ink placeholder-stone shadow-sm focus:border-deep-teal focus:outline-none focus:ring-2 focus:ring-deep-teal/20 transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-stone hover:text-slate-ink transition-colors"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? (
                      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative flex w-full justify-center rounded-xl bg-deep-teal px-4 py-3 text-sm font-semibold text-white shadow-md shadow-deep-teal/25 hover:bg-forest-teal hover:shadow-lg hover:shadow-deep-teal/30 focus:outline-none focus:ring-2 focus:ring-deep-teal focus:ring-offset-2 focus:ring-offset-soft-ivory disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  Entrando…
                </span>
              ) : (
                "Entrar"
              )}
            </button>
          </form>

          {/* Mobile copyright */}
          <p className="text-center text-xs text-stone/60 lg:hidden">
            © {new Date().getFullYear()} Oria
          </p>
        </div>
      </div>
    </div>
  );
}
