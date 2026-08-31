"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface Message {
  metaMessageId: string;
  contactPhone: string;
  contactName?: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  timestamp: string;
}

interface SimulatedProfile {
  phone: string;
  name: string;
}

const initialProfiles: SimulatedProfile[] = [
  { name: "Ana Silva", phone: "5511999990001" },
  { name: "Bruno Costa", phone: "5521999990002" },
  { name: "Carla Souza", phone: "5541999990003" },
];

export default function TemporaryUserSimulatorPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [activeProfile, setActiveProfile] = useState(initialProfiles[0]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lastPayload, setLastPayload] = useState<object | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/whatsapp/messages?limit=200&source=simulator",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
      const data = (await response.json()) as { messages: Message[] };
      setMessages(data.messages);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Falha ao carregar mensagens.",
      );
    }
  }, []);

  useEffect(() => {
    void loadMessages();
    const interval = window.setInterval(() => void loadMessages(), 3000);
    return () => window.clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeProfile.phone, messages]);

  const activeMessages = messages
    .filter((message) => message.contactPhone === activeProfile.phone)
    .slice()
    .reverse();
  const waitingForAssistant = activeMessages.at(-1)?.direction === "inbound";

  async function sendSimulatedMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSending(true);
    setError("");

    try {
      const response = await fetch("/api/dev/whatsapp-simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activeProfile.phone,
          name: activeProfile.name,
          body: formData.get("body"),
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        payload?: object;
      };

      if (!response.ok) throw new Error(result.error ?? "Falha na simulação.");
      setLastPayload(result.payload ?? null);
      form.reset();
      await loadMessages();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Falha na simulação.");
    } finally {
      setSending(false);
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? "";
    const phone = formData.get("phone")?.toString().replace(/\D/g, "") ?? "";
    if (!name || !phone) return;

    const profile = { name, phone };
    setProfiles((current) => [
      profile,
      ...current.filter((item) => item.phone !== phone),
    ]);
    setActiveProfile(profile);
  }

  return (
    <div className="animate-fade-in-up space-y-6">
      <header className="border-b border-mist pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-burnt-coral">Ferramenta temporária</p>
            <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">
              Simulador de usuários WhatsApp
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone">
              Gera eventos no formato oficial da Meta e os processa pelo mesmo
              código do webhook, sem enviar mensagens reais.
            </p>
          </div>
          <span className="rounded-full bg-burnt-coral/10 px-3 py-1.5 text-xs font-semibold text-burnt-coral">
            Somente desenvolvimento
          </span>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-burnt-coral/30 bg-burnt-coral/5 px-4 py-3 text-sm text-burnt-coral">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Telefone simulado" className="overflow-hidden rounded-lg border border-mist bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist bg-deep-teal px-5 py-4 text-white">
            <div>
              <p className="font-semibold">{activeProfile.name}</p>
              <p className="mt-0.5 text-xs text-white/65">+{activeProfile.phone}</p>
            </div>
            <span className="text-xs text-white/70">Usuário simulado</span>
          </div>

          <div className="flex min-h-[480px] max-h-[560px] flex-col gap-3 overflow-y-auto bg-warm-sand/30 p-4 sm:p-6">
            {activeMessages.length === 0 && (
              <div className="m-auto max-w-xs text-center">
                <p className="text-sm font-semibold text-slate-ink">Nenhuma mensagem</p>
                <p className="mt-1 text-xs leading-5 text-stone">
                  Envie a primeira mensagem deste usuário para gerar um webhook.
                </p>
              </div>
            )}
            {activeMessages.map((message) => (
              <article
                key={message.metaMessageId}
                className={`max-w-[82%] rounded-lg px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
                  message.direction === "inbound"
                    ? "self-end rounded-br-sm bg-deep-teal text-white"
                    : "self-start rounded-bl-sm border border-mist bg-white text-slate-ink"
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm leading-5">
                  {message.body}
                </p>
                <p className={`mt-1 text-right text-[10px] ${message.direction === "inbound" ? "text-white/65" : "text-stone"}`}>
                  {formatTime(message.timestamp)} · {formatStatus(message.status)}
                </p>
              </article>
            ))}
            {waitingForAssistant && (
              <div className="self-start rounded-lg border border-mist bg-white px-3.5 py-2.5 text-xs text-stone shadow-sm" aria-live="polite">
                IA processando a mensagem…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendSimulatedMessage} className="border-t border-mist p-4">
            <div className="flex items-end gap-2">
              <textarea
                name="body"
                required
                maxLength={4096}
                rows={2}
                placeholder={`Mensagem de ${activeProfile.name}`}
                className="min-h-11 flex-1 resize-none rounded-lg border border-mist bg-soft-ivory px-3 py-2.5 text-sm outline-none focus:border-deep-teal focus:ring-2 focus:ring-deep-teal/15"
              />
              <button
                type="submit"
                disabled={sending}
                className="h-11 rounded-lg bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50"
              >
                {sending ? "Simulando..." : "Enviar como usuário"}
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-mist bg-white p-4">
            <h2 className="font-heading text-sm font-semibold text-slate-ink">
              Usuários simulados
            </h2>
            <div className="mt-3 space-y-1">
              {profiles.map((profile) => (
                <button
                  key={profile.phone}
                  type="button"
                  onClick={() => setActiveProfile(profile)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left ${
                    profile.phone === activeProfile.phone
                      ? "bg-deep-teal/10 text-deep-teal"
                      : "text-slate-ink hover:bg-warm-sand/50"
                  }`}
                >
                  <span className="block text-sm font-semibold">{profile.name}</span>
                  <span className="mt-0.5 block text-xs opacity-70">+{profile.phone}</span>
                </button>
              ))}
            </div>

            <form onSubmit={saveProfile} className="mt-4 space-y-3 border-t border-mist pt-4">
              <p className="text-xs font-semibold uppercase text-stone">Adicionar usuário</p>
              <input name="name" required placeholder="Nome" className="block w-full rounded-lg border border-mist px-3 py-2 text-sm outline-none focus:border-deep-teal" />
              <input name="phone" required inputMode="tel" placeholder="Telefone com DDI" className="block w-full rounded-lg border border-mist px-3 py-2 text-sm outline-none focus:border-deep-teal" />
              <button type="submit" className="w-full rounded-lg border border-deep-teal/20 px-3 py-2 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5">
                Usar este usuário
              </button>
            </form>
          </section>

          <details className="overflow-hidden rounded-lg border border-mist bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-ink">
              Último payload gerado
            </summary>
            <pre className="max-h-80 overflow-auto border-t border-mist bg-slate-ink p-4 text-xs leading-5 text-white/80">
              {lastPayload
                ? JSON.stringify(lastPayload, null, 2)
                : "Envie uma mensagem para visualizar o payload."}
            </pre>
          </details>
        </aside>
      </div>
    </div>
  );
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatStatus(status: string) {
  if (status === "received") return "recebida";
  if (status === "sent") return "enviada";
  if (status === "failed") return "falhou";
  return status;
}