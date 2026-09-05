import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAgentConfiguration } from "@/lib/assistant/agent";
import { listCustomers } from "@/lib/crm";
import { getEmbeddedSignupConfiguration } from "@/lib/whatsapp";
import AutoRefresh from "../../_components/auto-refresh";
import EmbeddedSignupSettings from "../_components/embedded-signup-settings";
import SystemControls from "../_components/system-controls";

export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  const [assistantSettings, customers, embeddedSignup] = await Promise.all([
    getAgentConfiguration(),
    listCustomers(),
    getEmbeddedSignupConfiguration(),
  ]);

  return <div className="animate-fade-in-up space-y-8">
    <AutoRefresh />
    <nav aria-label="Navegação estrutural" className="flex items-center gap-1.5 text-xs font-semibold text-stone"><Link href="/dashboard/settings" className="hover:text-deep-teal">Minha conta</Link><ChevronRight className="h-3.5 w-3.5" /><span className="text-slate-ink">Configurações</span></nav>
    <header className="border-b border-mist pb-6"><p className="text-sm font-semibold text-deep-teal">Administração</p><h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Configurações do sistema</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Credenciais operacionais, disponibilidade da automação e controles de manutenção.</p></header>
    <EmbeddedSignupSettings initialConfiguration={{
      appId: embeddedSignup.appId,
      configurationId: embeddedSignup.configurationId,
      graphVersion: embeddedSignup.graphVersion,
    }} />
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