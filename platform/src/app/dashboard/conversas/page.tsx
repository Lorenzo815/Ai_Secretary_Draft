import { MessageCircle } from "lucide-react";
import { ObjectId } from "mongodb";
import { getWhatsAppInboxDetail, listActiveWhatsAppInboxConversations } from "@/lib/whatsapp";
import WhatsAppInbox from "./_components/whatsapp-inbox";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  let conversations = await listActiveWhatsAppInboxConversations();
  const selectedId = conversations[0]?.customerId;
  let detail = selectedId ? await getWhatsAppInboxDetail(new ObjectId(selectedId)) : null;

  if (detail && !detail.availability.canSendText) {
    conversations = conversations.filter((conversation) => conversation.customerId !== detail!.customerId);
    const fallbackId = conversations[0]?.customerId;
    detail = fallbackId ? await getWhatsAppInboxDetail(new ObjectId(fallbackId)) : null;
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-0 animate-fade-in-up flex-col gap-4 overflow-hidden lg:h-[calc(100dvh-5rem)]">
      <header className="shrink-0 border-b border-mist pb-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-deep-teal"><MessageCircle className="h-4 w-4" />WhatsApp</p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-slate-ink">Conversas</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone">Por padrão, mostramos chats dentro da janela de atendimento. Use os filtros para consultar também conversas históricas.</p>
      </header>
      <div className="min-h-0 flex-1">
        <WhatsAppInbox initialConversations={conversations} initialDetail={detail} />
      </div>
    </div>
  );
}
