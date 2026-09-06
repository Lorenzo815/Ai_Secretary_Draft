import Link from "next/link";
import { ExternalLink, MessageSquareText } from "lucide-react";
import { listWhatsAppTemplates, type WhatsAppTemplate } from "@/lib/whatsapp";
import TemplatesManager from "./_components/templates-manager";

export const dynamic = "force-dynamic";

export default async function WhatsAppTemplatesPage() {
  let templates: WhatsAppTemplate[] = [];
  let loadError: string | null = null;
  try {
    templates = await listWhatsAppTemplates();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Não foi possível consultar os modelos da Meta.";
  }

  return <div className="animate-fade-in-up space-y-6 pb-10">
    <header className="flex flex-col gap-4 border-b border-mist pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="flex items-center gap-2 text-sm font-semibold text-deep-teal"><MessageSquareText className="h-4 w-4" />WhatsApp</p><h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Modelos de mensagem</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-stone">Gerencie as mensagens aprovadas para iniciar conversas fora da janela de atendimento.</p></div>
      <Link href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer" className="inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-md border border-mist bg-white px-4 text-sm font-semibold text-slate-ink shadow-sm transition-colors hover:border-stone hover:bg-pearl">WhatsApp Manager<ExternalLink className="h-4 w-4" /></Link>
    </header>
    <TemplatesManager initialTemplates={templates} loadError={loadError} />
  </div>;
}