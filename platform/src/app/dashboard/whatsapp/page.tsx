"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface IntegrationStatus {
  configured: boolean;
  missingVariables: string[];
  phoneNumberId: string | null;
  businessAccountId: string | null;
  graphVersion: string;
  webhookUrl: string;
  webhookVerificationConfigured: boolean;
  webhookSignatureConfigured: boolean;
}

interface Message {
  metaMessageId: string;
  contactPhone: string;
  contactName?: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string;
  status: string;
  timestamp: string;
}

export default function WhatsAppPage() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const contacts = Array.from(
    messages.reduce((result, message) => {
      if (!result.has(message.contactPhone)) {
        result.set(message.contactPhone, {
          phone: message.contactPhone,
          name: message.contactName,
          preview: message.body,
          timestamp: message.timestamp,
        });
      } else if (!result.get(message.contactPhone)?.name && message.contactName) {
        result.get(message.contactPhone)!.name = message.contactName;
      }
      return result;
    }, new Map<string, { phone: string; name?: string; preview: string; timestamp: string }>()).values(),
  );
  const activePhone = selectedPhone || contacts[0]?.phone || "";
  const activeContact = contacts.find((contact) => contact.phone === activePhone);
  const activeMessages = messages
    .filter((message) => message.contactPhone === activePhone)
    .slice()
    .reverse();

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [statusResponse, messagesResponse] = await Promise.all([
        fetch("/api/whatsapp/status", { cache: "no-store" }),
        fetch("/api/whatsapp/messages?limit=100", { cache: "no-store" }),
      ]);
      if (!statusResponse.ok || !messagesResponse.ok) {
        throw new Error("Não foi possível carregar a integração.");
      }

      const statusData = (await statusResponse.json()) as IntegrationStatus;
      const messagesData = (await messagesResponse.json()) as { messages: Message[] };
      setStatus(statusData);
      setMessages(messagesData.messages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = window.setInterval(() => void loadData(), 5000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [activePhone, messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    setError("");
    setNotice("");

    try {
      const formData = new FormData(form);
      const response = await fetch("/api/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "text",
          to: activePhone,
          body: formData.get("body"),
        }),
      });
      const result = (await response.json()) as { error?: string; messageId?: string };

      if (!response.ok) {
        setError(result.error ?? "Falha ao enviar mensagem.");
      } else {
        form.reset();
        setNotice("Mensagem enviada.");
        await loadData();
      }
    } catch {
      setError("Não foi possível se comunicar com o servidor.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="animate-fade-in-up space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-mist pb-6">
        <div>
          <p className="text-sm font-medium text-deep-teal">Integrações</p>
          <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">
            WhatsApp Business
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">
            Consulte conversas recebidas pelo webhook e responda seus clientes
            diretamente pela Oria. Novas mensagens aparecem automaticamente.
          </p>
        </div>
        <StatusBadge configured={status?.configured ?? false} loading={loading} />
      </header>

      {(error || notice) && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-burnt-coral/30 bg-burnt-coral/5 text-burnt-coral"
              : "border-deep-teal/20 bg-deep-teal/5 text-deep-teal"
          }`}
        >
          {error || notice}
        </div>
      )}

      {!loading && status && !status.configured && (
        <div className="rounded-lg border border-burnt-coral/30 bg-burnt-coral/5 px-4 py-3 text-sm text-burnt-coral">
          Configure no arquivo <code>.env.local</code> e reinicie o servidor: {(status.missingVariables ?? ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]).join(", ")}.
        </div>
      )}

      {!loading && status?.webhookUrl.includes("localhost") && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Para receber mensagens reais, publique o webhook em uma URL HTTPS acessível pela Meta. <code>localhost</code> funciona apenas para testes locais.
        </div>
      )}

      <section aria-label="Conversas do WhatsApp" className="grid min-h-[620px] overflow-hidden rounded-lg border border-mist bg-white lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-mist bg-soft-ivory lg:border-b-0 lg:border-r">
          <div className="border-b border-mist px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-sm font-semibold text-slate-ink">Conversas</h2>
              <button type="button" onClick={() => void loadData()} aria-label="Atualizar conversas" title="Atualizar conversas" className="text-lg leading-none text-stone hover:text-deep-teal">
                ↻
              </button>
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const phone = new FormData(event.currentTarget).get("newPhone")?.toString().replace(/\D/g, "");
                if (phone) setSelectedPhone(phone);
              }}
            >
              <input name="newPhone" aria-label="Novo telefone" placeholder="Novo telefone com DDI" className="min-w-0 flex-1 rounded-lg border border-mist bg-white px-3 py-2 text-xs outline-none focus:border-deep-teal" />
              <button type="submit" aria-label="Abrir nova conversa" title="Abrir nova conversa" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-deep-teal text-white">+</button>
            </form>
          </div>
          <div className="max-h-48 flex-1 overflow-y-auto lg:max-h-none">
            {contacts.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs leading-5 text-stone">
                {loading ? "Carregando..." : "Nenhuma conversa recebida."}
              </p>
            ) : (
              contacts.map((contact) => (
                <button
                  key={contact.phone}
                  type="button"
                  onClick={() => setSelectedPhone(contact.phone)}
                  className={`w-full border-b border-mist/70 px-4 py-3 text-left transition-colors ${activePhone === contact.phone ? "bg-white" : "hover:bg-white/60"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-ink">{contact.name || contact.phone}</span>
                    <span className="shrink-0 text-[10px] text-stone">{formatTime(contact.timestamp)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-stone">{contact.preview}</p>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-h-[500px] min-w-0 flex-col">
          {activePhone ? (
            <>
              <div className="border-b border-mist px-5 py-3.5">
                <p className="text-sm font-semibold text-slate-ink">{activeContact?.name || activePhone}</p>
                <p className="mt-0.5 text-xs text-stone">+{activePhone}</p>
              </div>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-warm-sand/25 p-4 sm:p-6">
                {activeMessages.length === 0 && (
                  <p className="m-auto text-center text-sm text-stone">Nova conversa. Escreva a primeira mensagem abaixo.</p>
                )}
                {activeMessages.map((message) => (
                  <article
                    key={message.metaMessageId}
                    className={`max-w-[82%] rounded-lg px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
                      message.direction === "outbound"
                        ? "self-end rounded-br-sm bg-deep-teal text-white"
                        : "self-start rounded-bl-sm border border-mist bg-white text-slate-ink"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p>
                    <p className={`mt-1.5 text-right text-[10px] ${message.direction === "outbound" ? "text-white/65" : "text-stone"}`}>
                      {formatTime(message.timestamp)}{message.direction === "outbound" ? ` · ${translateStatus(message.status)}` : ""}
                    </p>
                  </article>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={handleSubmit} className="border-t border-mist bg-white p-3 sm:p-4">
                <div className="flex items-end gap-2">
                  <textarea
                    name="body"
                    required
                    maxLength={4096}
                    rows={2}
                    placeholder="Escreva uma mensagem"
                    className="min-h-11 flex-1 resize-none rounded-lg border border-mist bg-soft-ivory px-3 py-2.5 text-sm outline-none focus:border-deep-teal focus:ring-2 focus:ring-deep-teal/15"
                  />
                  <button
                    type="submit"
                    disabled={sending || !status?.configured}
                    className="h-11 rounded-lg bg-deep-teal px-4 text-sm font-semibold text-white transition-colors hover:bg-forest-teal disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sending ? "Enviando..." : "Enviar"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-stone">Texto livre funciona durante a janela de atendimento de 24 horas. Fora dela, use um template aprovado.</p>
              </form>
            </>
          ) : (
            <div className="m-auto max-w-xs px-6 text-center">
              <p className="text-sm font-semibold text-slate-ink">Selecione uma conversa</p>
              <p className="mt-1 text-xs leading-5 text-stone">Escolha um contato à esquerda ou informe um novo telefone com DDI.</p>
            </div>
          )}
        </div>
      </section>

      <details className="overflow-hidden rounded-lg border border-mist bg-white">
        <summary className="cursor-pointer px-5 py-4 font-heading text-sm font-semibold text-slate-ink">Configuração técnica</summary>
        <dl className="grid gap-px border-t border-mist bg-mist sm:grid-cols-2">
          <ConfigItem label="Versão da Graph API" value={status?.graphVersion ?? "v25.0"} />
          <ConfigItem label="ID do número" value={status?.phoneNumberId ?? "Não configurado"} />
          <ConfigItem label="ID da conta comercial" value={status?.businessAccountId ?? "Opcional"} />
          <ConfigItem label="Validação de assinatura" value={status?.webhookSignatureConfigured ? "Ativa" : "Não configurada"} />
        </dl>
        <div className="space-y-2 border-t border-mist px-5 py-4">
          <label htmlFor="webhook-url" className="text-xs font-semibold uppercase text-stone">URL de retorno para a Meta</label>
          <input id="webhook-url" readOnly value={status?.webhookUrl ?? "Carregando..."} className="block w-full rounded-lg border border-mist bg-soft-ivory px-3 py-2.5 text-sm text-slate-ink outline-none" />
          <p className="text-xs leading-5 text-stone">A Meta exige uma URL HTTPS pública e o mesmo <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code> configurado no servidor.</p>
        </div>
      </details>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-4">
      <dt className="text-xs font-medium text-stone">{label}</dt>
      <dd className="mt-1 break-all text-sm font-semibold text-slate-ink">{value}</dd>
    </div>
  );
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function translateStatus(status: string) {
  return ({ sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" } as Record<string, string>)[status] ?? status;
}

function StatusBadge({ configured, loading }: { configured: boolean; loading: boolean }) {
  const label = loading ? "Verificando" : configured ? "Configurada" : "Configuração incompleta";
  return (
    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${configured ? "bg-deep-teal/10 text-deep-teal" : "bg-warm-sand text-slate-ink/70"}`}>
      {label}
    </span>
  );
}