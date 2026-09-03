import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getAgentConfiguration } from "@/lib/assistant/agent";
import AutoRefresh from "../../_components/auto-refresh";
import SystemControls from "../_components/system-controls";

export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  const assistantSettings = await getAgentConfiguration();

  return <div className="animate-fade-in-up space-y-8">
    <AutoRefresh />
    <nav aria-label="Navegação estrutural" className="flex items-center gap-1.5 text-xs font-semibold text-stone"><Link href="/dashboard/settings" className="hover:text-deep-teal">Minha conta</Link><ChevronRight className="h-3.5 w-3.5" /><span className="text-slate-ink">Configurações</span></nav>
    <header className="border-b border-mist pb-6"><p className="text-sm font-semibold text-deep-teal">Administração</p><h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Configurações do sistema</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Credenciais operacionais, disponibilidade da automação e controles de manutenção.</p></header>
    <SystemControls
      initialProcessingEnabled={assistantSettings.enabled}
      initialPayment={{
        configured: Boolean(assistantSettings.payment.pixKey && assistantSettings.payment.recipientName),
        recipientName: assistantSettings.payment.recipientName,
        signalAmountCents: assistantSettings.payment.signalAmountCents,
      }}
    />
  </div>;
}