"use client";

import { useRef, useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { ACCESS_MODULES, emptyPermissions, type CompanySettings, type ManagedUser, type Permissions, type Principal } from "@/lib/access/contracts";

const inputClass = "mt-1 w-full rounded-md border border-mist bg-white px-3 py-2 text-sm text-slate-ink disabled:bg-soft-ivory";
const buttonClass = "rounded-md bg-deep-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

export default function CompanyUsersSettings({ initial, principal }: { initial: CompanySettings; principal: Principal }) {
  const [data, setData] = useState(initial);
  const [profile, setProfile] = useState(initial.company);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [permissions, setPermissions] = useState<Permissions>(emptyPermissions());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [transferId, setTransferId] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const usersHeading = useRef<HTMLHeadingElement>(null);

  async function submit(url: string, method: string, body: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar.");
      if (result.signInRequired) {
        await signOut({ callbackUrl: "/login" });
        return false;
      }
      setData(result);
      setProfile(result.company);
      setNotice("Alterações salvas.");
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha de conexão.");
      return false;
    } finally { setBusy(false); }
  }

  function startUser(user: ManagedUser | null) {
    setEditing(user);
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setPassword("");
    setDisabled(user?.disabled ?? false);
    setPermissions(user ? { ...user.permissions } : emptyPermissions());
    setShowUserForm(true);
    setError("");
    setNotice("");
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    if (await submit("/api/company/users", editing ? "PATCH" : "POST", {
      ...(editing ? { id: editing.id, disabled } : {}),
      name, email, ...(password ? { password } : {}), permissions,
    })) {
      setPassword("");
      setShowUserForm(false);
      setNotice(editing ? "Usuário atualizado." : "Usuário criado.");
      usersHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      usersHeading.current?.focus({ preventScroll: true });
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Excluir permanentemente a conta de ${user.name} (${user.email})? As sessões serão revogadas. Clientes, agendamentos e históricos operacionais serão preservados.`)) return;
    if (await submit("/api/company/users", "DELETE", { id: user.id, confirmation: "EXCLUIR" })) {
      if (editing?.id === user.id) {
        setShowUserForm(false);
        setPassword("");
      }
      setNotice("Usuário excluído.");
      usersHeading.current?.focus({ preventScroll: true });
    }
  }

  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-md border border-burnt-coral/30 bg-white p-4 text-sm text-burnt-coral">{error}</p>}
    {notice === "Alterações salvas." && <p role="status" className="rounded-md bg-deep-teal/10 p-4 text-sm text-deep-teal">{notice}</p>}
    <section className="rounded-lg border border-mist bg-white p-5 sm:p-6">
      <h2 className="font-heading text-lg font-semibold text-slate-ink">Empresa</h2>
      <dl className="mt-3 grid gap-3 text-xs text-stone sm:grid-cols-2">
        <div><dt>Identificador</dt><dd className="mt-1 break-all font-mono text-slate-ink">{data.company.id}</dd></div>
        <div><dt>Status</dt><dd className="mt-1 text-slate-ink">{data.company.status === "active" ? "Ativa" : data.company.status}</dd></div>
        <div><dt>Criada em</dt><dd className="mt-1 text-slate-ink">{new Date(data.company.createdAt).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</dd></div>
        <div><dt>Seu acesso</dt><dd className="mt-1 text-slate-ink">{principal.isAdmin ? "Administrador único" : "Permissões por módulo"}</dd></div>
        <div><dt>Administrador</dt><dd className="mt-1 text-slate-ink">{data.company.adminName} · {data.company.adminEmail}</dd></div>
      </dl>
      <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit("/api/company/settings", "PATCH", profile); }}>
        <fieldset disabled={!principal.isAdmin || busy} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-ink">Nome da empresa<input className={inputClass} required maxLength={160} value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })} /></label>
          <label className="text-sm text-slate-ink">Razão social<input className={inputClass} maxLength={200} value={profile.legalName} onChange={event => setProfile({ ...profile, legalName: event.target.value })} /></label>
          <label className="text-sm text-slate-ink">CNPJ<input className={inputClass} maxLength={18} value={profile.cnpj} onChange={event => setProfile({ ...profile, cnpj: event.target.value })} /></label>
          <label className="text-sm text-slate-ink">Email de contato<input type="email" className={inputClass} maxLength={254} value={profile.contactEmail} onChange={event => setProfile({ ...profile, contactEmail: event.target.value })} /></label>
          <label className="text-sm text-slate-ink">Telefone de contato<input type="tel" className={inputClass} maxLength={30} value={profile.contactPhone} onChange={event => setProfile({ ...profile, contactPhone: event.target.value })} /></label>
        </fieldset>
        {principal.isAdmin && <button className={buttonClass} disabled={busy}>Salvar empresa</button>}
      </form>
    </section>

    {!principal.isAdmin && <section className="rounded-lg border border-mist bg-white p-5">
      <h2 className="font-heading font-semibold text-slate-ink">Minhas permissões</h2>
      <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{ACCESS_MODULES.map(module => <li key={module.key}>{module.label}: <strong>{({ none: "Sem acesso", read: "Somente leitura", manage: "Gerenciar" })[principal.permissions[module.key]]}</strong></li>)}</ul>
    </section>}

    {principal.isAdmin && <section className="space-y-5 rounded-lg border border-mist bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 ref={usersHeading} tabIndex={-1} className="font-heading text-lg font-semibold text-slate-ink">Usuários · {data.users.length}/{data.userLimit}</h2><p className="mt-1 text-xs leading-5 text-stone">O limite inclui o administrador e contas desativadas. Excluir uma conta libera uma vaga. Novas contas começam sem acesso.</p></div>
        <button type="button" className={buttonClass} disabled={busy || data.users.length >= data.userLimit} onClick={() => startUser(null)}>Adicionar usuário</button>
      </div>
      {notice && notice !== "Alterações salvas." && <p role="status" className="rounded-md bg-deep-teal/10 p-3 text-sm text-deep-teal">{notice}</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-stone"><tr><th className="py-3">Nome / email</th><th>Tipo</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{data.users.map(user => <tr key={user.id} className="border-t border-mist">
        <td className="py-3 pr-3"><p className="font-semibold text-slate-ink">{user.name}</p><p className="text-xs text-stone">{user.email}</p></td>
        <td className="pr-3">{user.isAdmin ? "Administrador" : "Usuário"}</td><td className="pr-3">{user.disabled ? "Desativado" : "Ativo"}</td>
        <td><div className="flex gap-3"><button type="button" disabled={busy} className="font-semibold text-deep-teal" onClick={() => startUser(user)}>Editar</button>{!user.isAdmin && <button type="button" disabled={busy} className="font-semibold text-burnt-coral" onClick={() => void deleteUser(user)}>Excluir</button>}</div></td>
      </tr>)}</tbody></table></div>
      {showUserForm && <form onSubmit={saveUser} className="space-y-4 border-t border-mist pt-5" data-auto-refresh-dirty="true">
        <h3 className="font-heading font-semibold text-slate-ink">{editing ? "Editar usuário" : "Novo usuário"}</h3>
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Nome<input className={inputClass} required maxLength={120} autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>
            <label className="text-sm">Email<input className={inputClass} type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="text-sm">{editing ? "Nova senha (opcional)" : "Senha inicial"}<input className={inputClass} type="password" required={!editing} minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><span className="text-xs text-stone">Mínimo de 12 caracteres, máximo de 72 bytes.</span></label>
            {editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={disabled} disabled={editing.isAdmin} onChange={event => setDisabled(event.target.checked)} />Conta desativada</label>}
          </div>
          {editing?.isAdmin ? <p className="text-sm text-stone">O administrador tem acesso completo. Para alterar o administrador, use a transferência abaixo.</p> : <div className="space-y-3">
            <p className="text-xs leading-5 text-stone">Somente leitura bloqueia mutações na API. Visão geral libera os indicadores e resumos do dashboard, sem conceder acesso às outras páginas ou APIs. Clientes inclui histórico completo e pagamentos. Sistema permite acesso a integrações; limpeza de dados é exclusiva do administrador.</p>
            {ACCESS_MODULES.map(module => <label key={module.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-mist pb-3 text-sm">
              <span><strong>{module.label}</strong><span className="mt-1 block text-xs text-stone">{module.description}</span></span>
              <select aria-label={`Acesso: ${module.label}`} className="rounded-md border border-mist px-3 py-2" value={permissions[module.key]} onChange={event => setPermissions({ ...permissions, [module.key]: event.target.value as Permissions[typeof module.key] })}>
                <option value="none">Sem acesso</option><option value="read">Somente leitura</option><option value="manage">Gerenciar</option>
              </select>
            </label>)}
          </div>}
          <p className="text-xs text-stone">Salvar alterações revoga as sessões desta conta. Se editar sua própria conta, será necessário entrar novamente.</p>
          {error && <p role="alert" className="text-sm text-burnt-coral">{error}</p>}
          <div className="flex gap-3"><button className={buttonClass}>{busy ? "Salvando..." : "Salvar usuário"}</button><button type="button" className="text-sm font-semibold text-stone" onClick={() => { setShowUserForm(false); setPassword(""); }}>Cancelar</button></div>
        </fieldset>
      </form>}
      <form className="space-y-3 border-t border-mist pt-5" onSubmit={event => {
        event.preventDefault();
        if (window.confirm("Transferir a administração? Você perderá o acesso administrativo e ambas as contas deverão entrar novamente.")) {
          void submit("/api/company/transfer-admin", "POST", { userId: transferId, currentPassword });
        }
      }}>
        <h3 className="font-heading font-semibold text-slate-ink">Transferir administrador</h3>
        <p className="text-xs leading-5 text-stone">Sempre existe um único administrador. A conta anterior volta a usar suas permissões por módulo, sem acesso administrativo automático.</p>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Novo administrador<select className={inputClass} required value={transferId} onChange={event => setTransferId(event.target.value)}><option value="">Selecione uma conta ativa</option>{data.users.filter(user => !user.isAdmin && !user.disabled).map(user => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
          <label className="text-sm">Sua senha atual<input className={inputClass} type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
        </fieldset>
        <button className={buttonClass} disabled={busy || !transferId}>Transferir administração</button>
      </form>
    </section>}
  </div>;
}
