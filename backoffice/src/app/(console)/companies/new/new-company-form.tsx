"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Wand2 } from "lucide-react";
import { useGuardedAction } from "@/components/guarded-action";
import { Card, buttonClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { createCompanyAction } from "../../actions";

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint32Array(18));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

export function NewCompanyForm() {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [password, setPassword] = useState("");
  const [isolationReady, setIsolationReady] = useState(true);

  function submit(form: HTMLFormElement) {
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    run(() => createCompanyAction({ ...data, adminPassword: password, isolationReady }), {
      success: "Clínica criada. Guarde a senha do administrador antes de sair desta tela.",
      onSuccess: (id) => router.push(`/companies/${id}?created=1`),
    });
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }} className="grid max-w-4xl gap-6">
      {ui}
      <Card title="Clínica" description="Dados exibidos para a equipe da clínica.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className={labelClass}>Nome da clínica *</span><input name="name" required maxLength={160} className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>Razão social</span><input name="legalName" maxLength={200} className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>CNPJ</span><input name="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>E-mail de contato</span><input name="contactEmail" type="email" className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>Telefone de contato</span><input name="contactPhone" className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>Status</span>
            <select name="status" defaultValue="test" className={`${inputClass} mt-1`}>
              <option value="test">Teste</option><option value="active">Ativa</option>
            </select>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-mist p-3 sm:mt-5">
            <input type="checkbox" checked={isolationReady} onChange={(event) => setIsolationReady(event.target.checked)} className="mt-1 h-4 w-4 accent-deep-teal" />
            <span>
              <span className="text-sm font-semibold text-slate-ink">Liberar acesso</span>
              <span className="block text-xs text-slate-ink/60">Permite login e tráfego de WhatsApp (exige TENANT_STRICT=true na plataforma).</span>
            </span>
          </label>
        </div>
      </Card>

      <Card title="Administrador da clínica" description="Primeira conta, com acesso total à clínica.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={labelClass}>Nome *</span><input name="adminName" required maxLength={120} className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>E-mail de login *</span><input name="adminEmail" type="email" required className={`${inputClass} mt-1`} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Senha inicial * (mínimo 12 caracteres)</span>
            <div className="mt-1 flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-ink/40" />
                <input value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} className={`${inputClass} pl-9 font-mono`} />
              </div>
              <button type="button" onClick={() => setPassword(generatePassword())} className={secondaryButtonClass}><Wand2 className="h-4 w-4" />Gerar</button>
            </div>
            <span className="mt-1 block text-xs text-slate-ink/50">A senha não é exibida novamente depois de salvar. Envie-a ao administrador por um canal seguro.</span>
          </label>
        </div>
      </Card>

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Criando…" : "Criar clínica"}</button>
      </div>
    </form>
  );
}
