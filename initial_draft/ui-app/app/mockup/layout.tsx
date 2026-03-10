import Link from "next/link";
import AppShellNav from "./_components/app-shell-nav";

const alerts = [
  "WhatsApp desconectado em Workspace Agencia Sul.",
  "Limite de tokens em 86% para o plano Growth.",
  "Webhook CRM retornou erro 429 em 3 eventos."
];

const toasts = [
  "Flow 'Lead Express' validado com sucesso.",
  "Canal Web Widget conectado.",
  "Regra de fallback atualizada no Multi-LLM Router."
];

export default function MockupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mockup-shell">
      <aside className="mockup-sidebar">
        <div>
          <p className="logo">AI Secretary</p>
          <label className="workspace-selector" htmlFor="workspace">
            Workspace
            <select id="workspace" defaultValue="Empresa Demo">
              <option>Empresa Demo</option>
              <option>Agencia Sul</option>
              <option>Clinica Prime</option>
            </select>
          </label>
        </div>
        <AppShellNav />
        <Link className="button secondary" href="/mockup/onboarding">
          Abrir Onboarding Wizard
        </Link>
      </aside>

      <div className="mockup-content-wrap">
        <header className="mockup-topbar">
          <input
            aria-label="Buscar conversas, flows e templates"
            className="topbar-search"
            placeholder="Buscar conversas, flows e templates"
          />
          <div className="topbar-actions">
            <span className="channel-status offline">WhatsApp desconectado</span>
            <button className="button primary" type="button">
              Criar
            </button>
            <button className="avatar" type="button" aria-label="Perfil">
              LV
            </button>
          </div>
        </header>

        <main className="mockup-main">{children}</main>
      </div>

      <aside className="alert-center" aria-label="Alert center">
        <h3>Alert Center</h3>
        <ul>
          {alerts.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </aside>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <p key={toast} className="toast-item">
            {toast}
          </p>
        ))}
      </div>
    </div>
  );
}
