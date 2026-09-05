import Link from "next/link";
import { Bot, ChevronRight, CircleDollarSign, Radio, Settings2 } from "lucide-react";
import { getAgentConfiguration } from "@/lib/assistant/agent";
import { listCustomers } from "@/lib/crm";
import { getEmbeddedSignupConfiguration, getEmbeddedSignupConnectionStatus } from "@/lib/whatsapp";
import AutoRefresh from "../../_components/auto-refresh";
import EmbeddedSignupSettings from "../_components/embedded-signup-settings";
import SystemControls from "../_components/system-controls";

export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  const [assistantSettings, customers, embeddedSignup, embeddedConnection] = await Promise.all([
    getAgentConfiguration(),
    listCustomers(),
    getEmbeddedSignupConfiguration(),
    getEmbeddedSignupConnectionStatus(),
  ]);

  const connectionStatus = embeddedConnection?.status === "operational"
    ? "Operacional"
    : embeddedConnection?.status === "connected"
      ? "Pronta para ativar"
      : "Não conectada";

  return <div className="animate-fade-in-up space-y-6 pb-10">
    <AutoRefresh />
    <nav aria-label="Navegação estrutural" className="flex items-center gap-1.5 text-xs font-semibold text-stone"><Link href="/dashboard/settings" className="hover:text-deep-teal">Minha conta</Link><ChevronRight className="h-3.5 w-3.5" /><span className="text-slate-ink">Configurações</span></nav>
    <header className="flex flex-col gap-4 border-b border-mist pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="flex items-center gap-2 text-sm font-semibold text-deep-teal"><Settings2 className="h-4 w-4" />Administração</p><h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Configurações do sistema</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Integrações, automação e parâmetros que controlam a operação da Oria.</p></div>
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-mist bg-white px-3 py-1.5 text-xs font-semibold text-slate-ink"><span className="h-2 w-2 rounded-full bg-soft-jade" />Ambiente protegido</span>
    </header>

    <section aria-label="Resumo operacional" className="grid overflow-hidden rounded-lg border border-mist bg-white sm:grid-cols-3 sm:divide-x sm:divide-mist">
      <StatusSummary icon={Radio} label="WhatsApp" value={connectionStatus} active={embeddedConnection?.status === "operational"} />
      <StatusSummary icon={Bot} label="Respostas automáticas" value={assistantSettings.enabled ? "Ativas" : "Pausadas"} active={assistantSettings.enabled} />
      <StatusSummary icon={CircleDollarSign} label="Sinal via Pix" value={assistantSettings.payment.pixKey ? "Configurado" : "Pendente"} active={Boolean(assistantSettings.payment.pixKey)} />
    </section>

    <div className="space-y-2 pt-2"><p className="text-[11px] font-bold uppercase text-deep-teal">Canais e credenciais</p><h2 className="font-heading text-lg font-semibold text-slate-ink">Integrações</h2></div>
    <div className="rounded-lg border border-mist bg-white px-5 py-5 shadow-sm sm:px-6">
      <EmbeddedSignupSettings initialConfiguration={{
        appId: embeddedSignup.appId,
        configurationId: embeddedSignup.configurationId,
        graphVersion: embeddedSignup.graphVersion,
      }} initialConnection={embeddedConnection ? {
        connectionId: embeddedConnection.connectionId,
        status: embeddedConnection.status,
        wabaId: embeddedConnection.wabaId,
        phoneNumberId: embeddedConnection.phoneNumberId,
      } : null} />
    </div>

    <div className="space-y-2 pt-2"><p className="text-[11px] font-bold uppercase text-deep-teal">Regras da operação</p><h2 className="font-heading text-lg font-semibold text-slate-ink">Automação e pagamentos</h2></div>
    <SystemControls
      initialProcessingEnabled={assistantSettings.enabled}
      initialPayment={{
        configured: Boolean(assistantSettings.payment.pixKey && assistantSettings.payment.recipientName),
        recipientName: assistantSettings.payment.recipientName,
        signalAmountCents: assistantSettings.payment.signalAmountCents,
      }}
      initialCustomers={customers.map((customer) => ({
        id: customer._id.toHexString(),
        label: customer.phones[0]
          ? `${customer.name} · final ${customer.phones[0].slice(-4)}`
          : customer.name,
      }))}
    />
  </div>;
}

function StatusSummary({ icon: Icon, label, value, active }: { icon: typeof Radio; label: string; value: string; active: boolean }) {
  return <div className="flex items-center gap-3 border-b border-mist px-4 py-4 last:border-b-0 sm:border-b-0 sm:px-5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${active ? "bg-deep-teal/10 text-deep-teal" : "bg-warm-sand text-stone"}`}><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-xs font-semibold text-stone">{label}</p><p className="mt-0.5 truncate text-sm font-bold text-slate-ink">{value}</p></div></div>;
}