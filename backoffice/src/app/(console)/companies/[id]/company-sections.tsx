"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Crown, PhoneCall, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { useGuardedAction } from "@/components/guarded-action";
import { Badge, Card, buttonClass, dangerButtonClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { ACCESS_MODULES, emptyPermissions, type AccessLevel, type Permissions } from "@/lib/platform-rules";
import {
  addWhatsAppConnectionAction, copyAiConfigAction, createUserAction, deleteCompanyAction, previewCompanyDeletionAction, saveAiConfigAction,
  setCompanyAdminAction, setConnectionStatusAction, updateCompanyAction, updateUserAction,
} from "../../actions";

// ---------- profile ----------

export function ProfileSection({ companyId, company, legacy }: {
  companyId: string;
  company: { name: string; legalName: string; cnpj: string; contactEmail: string; contactPhone: string; status: string; isolationReady: boolean };
  legacy: boolean;
}) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [isolationReady, setIsolationReady] = useState(company.isolationReady);
  return (
    <Card title="Perfil e acesso">
      {ui}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        run((confirmation) => updateCompanyAction(companyId, { ...data, isolationReady }, confirmation), { onSuccess: () => router.refresh() });
      }}>
        <label className="sm:col-span-2"><span className={labelClass}>Nome</span><input name="name" defaultValue={company.name} className={`${inputClass} mt-1`} /></label>
        <label><span className={labelClass}>Razão social</span><input name="legalName" defaultValue={company.legalName} className={`${inputClass} mt-1`} /></label>
        <label><span className={labelClass}>CNPJ</span><input name="cnpj" defaultValue={company.cnpj} className={`${inputClass} mt-1`} /></label>
        <label><span className={labelClass}>E-mail de contato</span><input name="contactEmail" defaultValue={company.contactEmail} className={`${inputClass} mt-1`} /></label>
        <label><span className={labelClass}>Telefone</span><input name="contactPhone" defaultValue={company.contactPhone} className={`${inputClass} mt-1`} /></label>
        <label><span className={labelClass}>Status</span>
          <select name="status" defaultValue={company.status} className={`${inputClass} mt-1`}>
            <option value="test">Teste</option><option value="active">Ativa</option><option value="suspended">Suspensa (bloqueia login e WhatsApp)</option>
          </select>
        </label>
        {!legacy && (
          <label className="flex items-start gap-3 rounded-xl border border-mist p-3 sm:mt-5">
            <input type="checkbox" checked={isolationReady} onChange={(event) => setIsolationReady(event.target.checked)} className="mt-1 h-4 w-4 accent-deep-teal" />
            <span><span className="text-sm font-semibold">Acesso liberado</span><span className="block text-xs text-slate-ink/60">Login e WhatsApp desta clínica.</span></span>
          </label>
        )}
        <div className="flex justify-end sm:col-span-2">
          <button disabled={pending} className={buttonClass}><Save className="h-4 w-4" />Salvar</button>
        </div>
      </form>
    </Card>
  );
}

// ---------- users ----------

interface UserView { id: string; name: string; email: string; disabled: boolean; permissions: Permissions; isAdmin: boolean; createdAt: string }

const levelLabel: Record<AccessLevel, string> = { none: "—", read: "Ler", manage: "Gerenciar" };

function PermissionGrid({ value, onChange, disabled }: { value: Permissions; onChange: (next: Permissions) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ACCESS_MODULES.map((module) => (
        <label key={module.key} className="flex items-center justify-between gap-2 rounded-lg border border-mist px-3 py-1.5 text-xs">
          <span className="font-medium">{module.label}</span>
          <select disabled={disabled} value={value[module.key]} onChange={(event) => onChange({ ...value, [module.key]: event.target.value as AccessLevel })}
            className="rounded border border-mist bg-white px-1.5 py-1 text-xs">
            {(["none", "read", "manage"] as const).map((level) => <option key={level} value={level}>{levelLabel[level]}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

export function UsersSection({ companyId, users, className }: { companyId: string; users: UserView[]; className?: string }) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => { setEditing(null); setAdding(false); router.refresh(); };

  return (
    <Card className={className} title={`Usuários (${users.length})`} description="Administradores têm acesso total; os demais seguem as permissões por área. Alterar um usuário encerra as sessões dele."
      actions={<button type="button" onClick={() => setAdding((value) => !value)} className={secondaryButtonClass}><UserPlus className="h-4 w-4" />Novo usuário</button>}>
      {ui}
      {adding && <UserForm submitLabel="Criar usuário" pending={pending} requirePassword onCancel={() => setAdding(false)}
        onSubmit={(input) => run((confirmation) => createUserAction(companyId, input, confirmation), { onSuccess: refresh })} />}
      <ul className="divide-y divide-mist">
        {users.map((user) => (
          <li key={user.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-ink">{user.name}</span>
              <span className="text-sm text-slate-ink/60">{user.email}</span>
              {user.isAdmin && <Badge tone="teal"><Crown className="h-3 w-3" />Administrador</Badge>}
              {user.disabled && <Badge tone="red">Desativado</Badge>}
              <span className="ml-auto flex gap-2">
                {!user.isAdmin && !user.disabled && (
                  <button type="button" disabled={pending} className="text-xs font-semibold text-deep-teal hover:underline"
                    onClick={() => run((confirmation) => setCompanyAdminAction(companyId, user.id, confirmation), { onSuccess: refresh })}>Tornar administrador</button>
                )}
                <button type="button" className="text-xs font-semibold text-slate-ink/70 hover:underline" onClick={() => setEditing(editing === user.id ? null : user.id)}>
                  {editing === user.id ? "Fechar" : "Editar"}
                </button>
              </span>
            </div>
            {!user.isAdmin && (
              <p className="mt-1 text-xs text-slate-ink/50">
                {ACCESS_MODULES.filter((module) => user.permissions[module.key] !== "none").map((module) => `${module.label}: ${levelLabel[user.permissions[module.key]]}`).join(" · ") || "Sem permissões"}
              </p>
            )}
            {editing === user.id && (
              <div className="mt-3">
                <UserForm initial={user} submitLabel="Salvar usuário" pending={pending} isAdmin={user.isAdmin} onCancel={() => setEditing(null)}
                  onSubmit={(input) => run((confirmation) => updateUserAction(companyId, user.id, input, confirmation), { onSuccess: refresh })} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UserForm({ initial, submitLabel, pending, requirePassword, isAdmin, onSubmit, onCancel }: {
  initial?: UserView; submitLabel: string; pending: boolean; requirePassword?: boolean; isAdmin?: boolean;
  onSubmit: (input: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [permissions, setPermissions] = useState<Permissions>(initial?.permissions ?? emptyPermissions());
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  return (
    <form className="mb-4 grid gap-3 rounded-xl border border-mist bg-soft-ivory/60 p-4 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      onSubmit({ ...data, permissions, disabled });
    }}>
      <label><span className={labelClass}>Nome</span><input name="name" required defaultValue={initial?.name} className={`${inputClass} mt-1`} /></label>
      <label><span className={labelClass}>E-mail</span><input name="email" type="email" required defaultValue={initial?.email} className={`${inputClass} mt-1`} /></label>
      <label className="sm:col-span-2"><span className={labelClass}>{requirePassword ? "Senha inicial (mín. 12 caracteres)" : "Nova senha (deixe vazio para manter)"}</span>
        <input name="password" type="text" autoComplete="off" required={requirePassword} minLength={requirePassword ? 12 : undefined} className={`${inputClass} mt-1 font-mono`} />
      </label>
      {isAdmin ? <p className="text-xs text-slate-ink/60 sm:col-span-2">Administradores têm acesso total; as permissões abaixo não se aplicam.</p> : (
        <div className="sm:col-span-2"><span className={labelClass}>Permissões</span><div className="mt-1"><PermissionGrid value={permissions} onChange={setPermissions} /></div></div>
      )}
      {initial && !isAdmin && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} className="h-4 w-4 accent-red-600" />Conta desativada</label>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>Cancelar</button>
        <button disabled={pending} className={buttonClass}>{submitLabel}</button>
      </div>
    </form>
  );
}

// ---------- WhatsApp ----------

interface ConnectionView {
  id: string; status: string; wabaId: string; phoneNumberId: string; displayPhoneNumber: string; label: string; graphVersion: string; updatedAt: string;
}

const statusTone = { operational: "teal", connected: "amber", disconnected: "gray", token_exchanged: "gray" } as const;
const statusLabel: Record<string, string> = { operational: "Em uso", connected: "Conectado (reserva)", disconnected: "Desconectado", token_exchanged: "Cadastro incompleto" };

export function WhatsAppSection({ companyId, connections, legacy }: { companyId: string; connections: ConnectionView[]; legacy: boolean }) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [adding, setAdding] = useState(false);
  const [makeOperational, setMakeOperational] = useState(true);
  const setStatus = (id: string, status: "operational" | "connected" | "disconnected") =>
    run((confirmation) => setConnectionStatusAction(companyId, id, status, confirmation), { onSuccess: () => router.refresh() });

  return (
    <Card title="Números de WhatsApp" description="Um número 'Em uso' por clínica responde e envia mensagens; os demais ficam de reserva. O caminho recomendado é a clínica conectar o próprio número pela tela Sistema da plataforma."
      actions={<button type="button" onClick={() => setAdding((value) => !value)} className={secondaryButtonClass}><Plus className="h-4 w-4" />Adicionar número</button>}>
      {ui}
      {legacy && connections.length === 0 && <p className="mb-3 text-sm text-slate-ink/60">Esta clínica usa o número configurado nas variáveis de ambiente da plataforma.</p>}
      {adding && (
        <form className="mb-4 grid gap-3 rounded-xl border border-mist bg-soft-ivory/60 p-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.currentTarget));
          run((confirmation) => addWhatsAppConnectionAction(companyId, { ...data, makeOperational }, confirmation), { onSuccess: () => { setAdding(false); router.refresh(); } });
        }}>
          <label><span className={labelClass}>Nome (opcional)</span><input name="label" placeholder="Recepção" className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>Número exibido</span><input name="displayPhoneNumber" placeholder="+55 42 99999-0000" className={`${inputClass} mt-1`} /></label>
          <label><span className={labelClass}>WABA ID *</span><input name="wabaId" required inputMode="numeric" className={`${inputClass} mt-1 font-mono`} /></label>
          <label><span className={labelClass}>Phone Number ID *</span><input name="phoneNumberId" required inputMode="numeric" className={`${inputClass} mt-1 font-mono`} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Access token (System User da Oria ou da clínica) *</span>
            <input name="accessToken" required type="password" autoComplete="off" className={`${inputClass} mt-1 font-mono`} />
            <span className="mt-1 block text-xs text-slate-ink/50">Gravado criptografado, no mesmo formato da plataforma.</span>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeOperational} onChange={(event) => setMakeOperational(event.target.checked)} className="h-4 w-4 accent-deep-teal" />Colocar em uso agora</label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className={secondaryButtonClass}>Cancelar</button>
            <button disabled={pending} className={buttonClass}><PhoneCall className="h-4 w-4" />Adicionar</button>
          </div>
        </form>
      )}
      {connections.length > 0 && (
        <ul className="divide-y divide-mist">
          {connections.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {connection.label || connection.displayPhoneNumber || connection.phoneNumberId || "Conexão"}
                  <Badge tone={statusTone[connection.status as keyof typeof statusTone] ?? "gray"}>{statusLabel[connection.status] ?? connection.status}</Badge>
                </p>
                <p className="font-mono text-[11px] text-slate-ink/50">WABA {connection.wabaId || "—"} · Phone {connection.phoneNumberId || "—"} · {connection.graphVersion}</p>
              </div>
              <div className="flex gap-2">
                {connection.status !== "operational" && connection.phoneNumberId && (
                  <button type="button" disabled={pending} onClick={() => setStatus(connection.id, "operational")} className="text-xs font-semibold text-deep-teal hover:underline">Colocar em uso</button>
                )}
                {connection.status === "operational" && (
                  <button type="button" disabled={pending} onClick={() => setStatus(connection.id, "connected")} className="text-xs font-semibold text-amber-700 hover:underline">Tirar de uso</button>
                )}
                {connection.status !== "disconnected" && (
                  <button type="button" disabled={pending} onClick={() => setStatus(connection.id, "disconnected")} className="text-xs font-semibold text-red-700 hover:underline">Desconectar</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- AI ----------

const AI_TEMPLATE = `{
  "activeProvider": "vercel",
  "tasks": {
    "customer_agent": { "vercelModel": "openai/gpt-5.4-mini", "vercelProvider": "auto", "azureModel": "gpt-5.4-mini", "maxCompletionTokens": 32768, "reasoningEffort": "high" },
    "lead_qualification": { "vercelModel": "openai/gpt-5.4-mini", "vercelProvider": "auto", "azureModel": "gpt-5.4-mini", "maxCompletionTokens": 8192, "reasoningEffort": "default" }
  },
  "audioTranscription": { "vercelModel": "openai/gpt-4o-mini-transcribe" }
}`;

export function AiSection({ companyId, json, revision, updatedBy, others }: {
  companyId: string; json: string; revision: number; updatedBy: string; others: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [text, setText] = useState(json || AI_TEMPLATE);
  const [targets, setTargets] = useState<string[]>([]);
  return (
    <Card title="Modelos de IA" description={json ? `Revisão ${revision} · última alteração por ${updatedBy || "—"}` : "Ainda sem configuração própria: a plataforma cria a padrão no primeiro uso. Salve abaixo para definir agora."}>
      {ui}
      <p className="mb-2 text-xs text-slate-ink/60">
        <code>vercelModel</code> usa o formato do Vercel AI Gateway (por exemplo <code>openai/gpt-5.4-mini</code>, <code>deepseek/deepseek-v4.1</code>).
        <code> reasoningEffort</code>: default, low, medium ou high. A chave do Gateway é da Oria e vale para todas as clínicas.
      </p>
      <textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} rows={14}
        className="w-full rounded-xl border border-mist bg-night p-3 font-mono text-xs leading-relaxed text-soft-jade outline-none focus:border-deep-teal" />
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={pending} className={buttonClass}
          onClick={() => run((confirmation) => saveAiConfigAction(companyId, text, confirmation), { onSuccess: () => router.refresh() })}>
          <Save className="h-4 w-4" />Salvar configuração
        </button>
      </div>
      {json && others.length > 0 && (
        <div className="mt-5 border-t border-mist pt-4">
          <p className="text-sm font-semibold">Aplicar esta configuração a outras clínicas</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {others.map((other) => (
              <label key={other.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium ${targets.includes(other.id) ? "border-deep-teal bg-deep-teal/10 text-deep-teal" : "border-mist"}`}>
                <input type="checkbox" className="sr-only" checked={targets.includes(other.id)}
                  onChange={(event) => setTargets((current) => event.target.checked ? [...current, other.id] : current.filter((id) => id !== other.id))} />
                {other.name}
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="text-xs font-semibold text-slate-ink/60 hover:underline" onClick={() => setTargets(others.map((other) => other.id))}>Selecionar todas</button>
            <button type="button" disabled={pending || targets.length === 0} className={`${secondaryButtonClass} ml-auto`}
              onClick={() => run((confirmation) => copyAiConfigAction(companyId, targets, confirmation), {
                success: `Configuração aplicada a ${targets.length} clínica(s).`, onSuccess: () => { setTargets([]); router.refresh(); },
              })}>
              <Copy className="h-4 w-4" />Aplicar a {targets.length || "…"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- danger zone ----------

export function DangerZone({ companyId, name, live, className }: { companyId: string; name: string; live: boolean; className?: string }) {
  const router = useRouter();
  const { run, pending, ui } = useGuardedAction();
  const [preview, setPreview] = useState<{ counts: Array<{ name: string; count: number }>; total: number } | null>(null);
  return (
    <section className={`rounded-2xl border border-red-200 bg-red-50/40 p-5 ${className ?? ""}`}>
      {ui}
      <h2 className="font-heading text-base font-semibold text-red-800">Zona de perigo</h2>
      <p className="mt-1 text-sm text-red-900/75">
        Excluir a clínica remove todos os dados dela (pacientes, conversas, agenda, usuários, números de WhatsApp e configurações). Não há como desfazer.
        {live && " Para excluir, primeiro altere o status para Teste ou Suspensa."}
      </p>
      {preview && (
        <div className="mt-3 rounded-xl border border-red-200 bg-white p-3 text-sm">
          <p className="font-semibold">{preview.total} documento(s) serão excluídos:</p>
          <ul className="mt-1 grid gap-x-6 text-xs text-slate-ink/70 sm:grid-cols-2 lg:grid-cols-3">
            {preview.counts.map((entry) => <li key={entry.name} className="flex justify-between gap-2"><code>{entry.name}</code><span className="tabular-nums">{entry.count}</span></li>)}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={secondaryButtonClass}
          onClick={() => run(() => previewCompanyDeletionAction(companyId), { success: "Prévia atualizada.", onSuccess: setPreview })}>
          Ver o que será excluído
        </button>
        <button type="button" disabled={pending || live} className={dangerButtonClass}
          onClick={() => run((confirmation) => deleteCompanyAction(companyId, confirmation), { onSuccess: () => router.push("/companies") })}>
          <Trash2 className="h-4 w-4" />Excluir “{name}”
        </button>
      </div>
    </section>
  );
}
