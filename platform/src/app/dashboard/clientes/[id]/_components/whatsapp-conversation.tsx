"use client";

import { Check, CheckCheck, CircleAlert, SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";

type MessageStatus = "received" | "sent" | "delivered" | "read" | "failed";

interface ConversationMessage {
  messageId: string;
  direction: "inbound" | "outbound";
  body: string;
  status: MessageStatus;
  sentBy?: string;
  timestamp: string;
}

interface MessageAvailability {
  canSendText: boolean;
  reason: string | null;
  expiresAt: string | null;
  recipientPhone: string | null;
}

export default function WhatsAppConversation({
  customerId,
  initialMessages,
  availability,
}: {
  customerId: string;
  initialMessages: ConversationMessage[];
  availability: MessageAvailability;
}) {
  const router = useRouter();
  const historyRef = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ConversationMessage[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const persistedIds = new Set(initialMessages.map((message) => message.messageId));
  const messages = [
    ...initialMessages,
    ...optimisticMessages.filter((message) => !persistedIds.has(message.messageId)),
  ];
  const expired = availability.expiresAt ? now >= new Date(availability.expiresAt).getTime() : true;
  const windowReason = blockedReason
    || (!availability.canSendText || expired
      ? availability.reason ?? "A janela de atendimento de 24 horas terminou. Use um modelo aprovado para iniciar uma nova conversa."
      : "");
  const canSend = !sending && !windowReason && Boolean(body.trim());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    const scrollToLatest = () => history.scrollTo({ top: history.scrollHeight });
    scrollToLatest();
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) scrollToLatest();
    });
    observer.observe(history);
    return () => observer.disconnect();
  }, [initialMessages.length, optimisticMessages.length]);

  async function sendMessage() {
    const messageBody = body.trim();
    if (!messageBody || !canSend) return;
    setSending(true);
    setError("");

    try {
      const response = await fetch(`/api/customers/${customerId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: messageBody }),
      });
      const result = await response.json() as {
        error?: string;
        code?: string;
        message?: ConversationMessage;
      };
      if (!response.ok || !result.message) {
        const message = result.error ?? "Não foi possível enviar a mensagem.";
        setError(message);
        if (result.code === "SERVICE_WINDOW_CLOSED") setBlockedReason(message);
        return;
      }

      setOptimisticMessages((current) => [...current, result.message!]);
      setBody("");
      startTransition(() => router.refresh());
    } catch {
      setError("Não foi possível conectar ao serviço de mensagens. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="history-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="history-title" className="font-heading text-base font-semibold text-slate-ink">Conversa no WhatsApp</h2>
          <p className="mt-1 text-xs text-stone">
            {availability.recipientPhone ? formatPhone(availability.recipientPhone) : "Contato sem telefone disponível"}
          </p>
        </div>
        <ServiceWindowStatus availability={availability} expired={expired} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-mist bg-white">
        <div ref={historyRef} className="flex min-h-[420px] max-h-[560px] flex-col gap-3 overflow-y-auto bg-warm-sand/25 p-4 sm:p-6">
          {messages.length === 0 ? (
            <p className="m-auto text-sm text-stone">Nenhuma mensagem registrada.</p>
          ) : messages.map((message) => (
            <article
              key={message.messageId}
              className={`max-w-[88%] rounded-lg px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${message.direction === "outbound" ? "self-end rounded-br-sm bg-deep-teal text-white" : "self-start rounded-bl-sm border border-mist bg-white text-slate-ink"}`}
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p>
              <div className={`mt-1.5 flex items-center justify-end gap-1.5 text-[10px] ${message.direction === "outbound" ? "text-white/70" : "text-stone"}`}>
                {message.direction === "outbound" && <span>{message.sentBy ? "Equipe" : "Oria"}</span>}
                <span>{formatDateTime(message.timestamp)}</span>
                {message.direction === "outbound" && <DeliveryStatus status={message.status} />}
              </div>
            </article>
          ))}
        </div>

        <form
          data-auto-refresh-dirty={body ? "true" : undefined}
          className="border-t border-mist bg-white p-3 sm:p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <label htmlFor="whatsapp-message" className="sr-only">Mensagem</label>
          <textarea
            id="whatsapp-message"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={Boolean(windowReason) || sending}
            maxLength={4_096}
            rows={3}
            placeholder={windowReason ? "Envio de texto indisponível" : "Escreva uma mensagem"}
            className="w-full resize-none rounded-md border border-mist bg-white px-3 py-2.5 text-sm leading-5 text-slate-ink outline-none transition focus:border-deep-teal focus:ring-2 focus:ring-deep-teal/15 disabled:cursor-not-allowed disabled:bg-soft-ivory disabled:text-stone"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${error ? "font-semibold text-burnt-coral" : "text-stone"}`} role={error ? "alert" : undefined}>
              {error || windowReason || `${body.length.toLocaleString("pt-BR")}/4.096 caracteres`}
            </p>
            <button
              type="submit"
              disabled={!canSend}
              title={windowReason || (sending ? "A mensagem está sendo enviada." : undefined)}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-deep-teal px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest-teal disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SendHorizontal aria-hidden="true" className="size-4" />
              {sending ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ServiceWindowStatus({ availability, expired }: { availability: MessageAvailability; expired: boolean }) {
  const active = availability.canSendText && !expired;
  return (
    <p className={`inline-flex items-center gap-2 text-xs font-semibold ${active ? "text-deep-teal" : "text-burnt-coral"}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-emerald-500" : "bg-burnt-coral"}`} />
      {active && availability.expiresAt
        ? `Janela ativa até ${formatDateTime(availability.expiresAt)}`
        : "Janela de texto encerrada"}
    </p>
  );
}

function DeliveryStatus({ status }: { status: MessageStatus }) {
  if (status === "failed") return <span aria-label="Falhou" title="Falhou"><CircleAlert className="size-3" /></span>;
  if (status === "read") return <span aria-label="Lida" title="Lida"><CheckCheck className="size-3 text-sky-200" /></span>;
  if (status === "delivered") return <span aria-label="Entregue" title="Entregue"><CheckCheck className="size-3" /></span>;
  return <span aria-label="Enviada" title="Enviada"><Check className="size-3" /></span>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatPhone(value: string) {
  return `+${value.replace(/\D/g, "")}`;
}