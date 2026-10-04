"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CalendarRange,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  UserRoundCheck,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import CustomerServiceStatusControl, { type ServiceStatus } from "@/components/customer-service-status-control";
import WhatsAppConversation from "../../clientes/[id]/_components/whatsapp-conversation";

interface Conversation {
  customerId: string;
  customerName: string;
  phone: string;
  serviceStatus: ServiceStatus;
  lastMessage: {
    messageId: string;
    direction: "inbound" | "outbound";
    type: string;
    preview: string;
    status: string;
    timestamp: string;
  };
  lastInboundAt: string;
  windowExpiresAt: string | null;
  withinServiceWindow: boolean;
  needsAttention: boolean;
  resolvedUntilNextMessage: boolean;
}

interface Detail {
  customerId: string;
  customerName: string;
  serviceStatus: ServiceStatus;
  needsAttention: boolean;
  attentionMessageId: string | null;
  messages: Array<{
    messageId: string;
    direction: "inbound" | "outbound";
    type: string;
    templateName?: string;
    body: string;
    media?: { mimeType?: string; caption?: string; filename?: string; transcription?: string };
    replyTo?: { body?: string; direction?: "inbound" | "outbound"; type?: string };
    status: "received" | "sent" | "delivered" | "read" | "failed";
    sentBy?: string;
    timestamp: string;
  }>;
  availability: {
    canSendText: boolean;
    reason: string | null;
    expiresAt: string | null;
    recipientPhone: string | null;
  };
}

interface InboxResult {
  conversations?: Conversation[];
  detail?: Detail | null;
  error?: string;
}

interface InboxFilters {
  includeOutsideWindow: boolean;
  startDate: string;
  endDate: string;
}

export default function WhatsAppInbox({
  initialConversations,
  initialDetail,
}: {
  initialConversations: Conversation[];
  initialDetail: Detail | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialDetail?.customerId ?? "");
  const [detail, setDetail] = useState(initialDetail);
  const [mobileListVisible, setMobileListVisible] = useState(!initialDetail);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const defaultDates = getDefaultDates();
  const [draftFilters, setDraftFilters] = useState<InboxFilters>({
    includeOutsideWindow: false,
    ...defaultDates,
  });
  const [filters, setFilters] = useState<InboxFilters>({
    includeOutsideWindow: false,
    ...defaultDates,
  });
  const deferredQuery = useDeferredValue(query);
  const refreshSequence = useRef(0);
  const filtered = conversations.filter((conversation) => (
    normalize(`${conversation.customerName} ${conversation.phone} ${conversation.lastMessage.preview}`)
      .includes(normalize(deferredQuery))
  ));
  const attentionCount = conversations.filter((conversation) => conversation.needsAttention).length;

  const refresh = useCallback(async (
    customerId = selectedId,
    quiet = false,
    requestedFilters = filters,
  ) => {
    const requestId = ++refreshSequence.current;
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (customerId) params.set("customerId", customerId);
      if (requestedFilters.includeOutsideWindow) {
        params.set("includeOutsideWindow", "true");
        params.set("startAt", localDateStart(requestedFilters.startDate).toISOString());
        params.set("endAt", localDateEnd(requestedFilters.endDate).toISOString());
      }
      const response = await fetch(`/api/whatsapp/inbox?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as InboxResult;
      if (!response.ok || !result.conversations) throw new Error(result.error ?? "Não foi possível carregar as conversas.");
      if (requestId !== refreshSequence.current) return;
      setConversations(result.conversations);
      if (result.detail) {
        setDetail(result.detail);
        setSelectedId(result.detail.customerId);
      } else if (!customerId || !result.conversations.some((conversation) => conversation.customerId === customerId)) {
        const fallbackId = result.conversations[0]?.customerId ?? "";
        setSelectedId(fallbackId);
        setDetail(null);
        if (fallbackId) window.setTimeout(() => void refresh(fallbackId, true, requestedFilters), 0);
      }
      setError("");
    } catch (refreshError) {
      if (!quiet && requestId === refreshSequence.current) {
        setError(refreshError instanceof Error ? refreshError.message : "Não foi possível carregar as conversas.");
      }
    } finally {
      if (requestId === refreshSequence.current) setLoading(false);
    }
  }, [filters, selectedId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(selectedId, true);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [refresh, selectedId]);

  async function selectConversation(customerId: string) {
    if (customerId === selectedId && detail) return;
    setMobileListVisible(false);
    setSelectedId(customerId);
    setDetail(null);
    await refresh(customerId);
  }

  async function applyFilterSelection(nextFilters: InboxFilters) {
    if (nextFilters.includeOutsideWindow && (
      !nextFilters.startDate
      || !nextFilters.endDate
      || nextFilters.startDate > nextFilters.endDate
    )) {
      setError("Informe um período válido para mostrar conversas fora da janela.");
      return;
    }
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setFiltersOpen(false);
    setSelectedId("");
    setDetail(null);
    await refresh("", false, nextFilters);
  }

  async function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await applyFilterSelection(draftFilters);
  }

  async function showActiveOnly() {
    await applyFilterSelection({
      includeOutsideWindow: false,
      ...getDefaultDates(),
    });
  }

  async function resolveAttention() {
    if (!detail?.attentionMessageId || resolving) return;
    setResolving(true);
    setError("");
    try {
      const response = await fetch("/api/whatsapp/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: detail.customerId,
          messageId: detail.attentionMessageId,
        }),
      });
      const result = await response.json() as { resolved?: boolean; error?: string };
      if (!response.ok || !result.resolved) throw new Error(result.error ?? "Não foi possível resolver a conversa.");
      await refresh(detail.customerId, true);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Não foi possível resolver a conversa.");
    } finally {
      setResolving(false);
    }
  }

  function updateStatus(status: ServiceStatus) {
    setConversations((current) => current.map((conversation) => (
      conversation.customerId === selectedId ? { ...conversation, serviceStatus: status } : conversation
    )));
    setDetail((current) => current ? { ...current, serviceStatus: status } : current);
  }

  return (
    <section className="grid h-full min-h-0 overflow-hidden rounded-lg border border-mist bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className={`${mobileListVisible ? "flex" : "hidden"} min-h-0 min-w-0 w-full flex-col overflow-hidden border-b border-mist bg-white lg:flex lg:border-b-0 lg:border-r`}>
        <div className="shrink-0 border-b border-mist p-4">
          <div className="flex items-center justify-between gap-3">
            <div><p className="font-heading text-base font-semibold text-slate-ink">{filters.includeOutsideWindow ? "Conversas" : "Chats ativos"}</p><p className="mt-0.5 text-xs text-stone">{conversations.length} conversas · {attentionCount} precisam de atenção</p></div>
            {loading && <LoaderCircle className="h-4 w-4 animate-spin text-deep-teal" />}
          </div>
          <div className="mt-3 flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Pesquisar conversas</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar conversa" className="w-full rounded-md border border-mist bg-pearl py-2.5 pl-9 pr-3 text-sm outline-none focus:border-deep-teal" />
            </label>
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="conversation-filters"
              onClick={() => setFiltersOpen((current) => !current)}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition ${filtersOpen || filters.includeOutsideWindow ? "border-deep-teal bg-deep-teal/10 text-deep-teal" : "border-mist bg-white text-stone hover:text-slate-ink"}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Filtros</span>
              {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
            <span className={`inline-flex rounded-full px-2 py-1 font-semibold ${filters.includeOutsideWindow ? "bg-deep-teal/10 text-deep-teal" : "bg-stone/10 text-stone"}`}>
              {filters.includeOutsideWindow
                ? `${formatShortDate(filters.startDate)} – ${formatShortDate(filters.endDate)}`
                : "Somente janela ativa"}
            </span>
            {filters.includeOutsideWindow && <button type="button" onClick={() => void showActiveOnly()} className="font-semibold text-stone hover:text-deep-teal">Limpar</button>}
          </div>
          {filtersOpen && <form id="conversation-filters" onSubmit={(event) => void applyFilters(event)} className="mt-3 rounded-md border border-mist bg-pearl/70 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-slate-ink">
              <input
                type="checkbox"
                checked={draftFilters.includeOutsideWindow}
                onChange={(event) => setDraftFilters((current) => ({
                  ...current,
                  includeOutsideWindow: event.target.checked,
                }))}
                className="mt-0.5 h-4 w-4 accent-deep-teal"
              />
              Mostrar também fora da janela
            </label>
            {draftFilters.includeOutsideWindow && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-stone">De
                  <input type="date" value={draftFilters.startDate} onChange={(event) => setDraftFilters((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full rounded border border-mist bg-white px-2 py-1.5 text-xs font-normal text-slate-ink" />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-stone">Até
                  <input type="date" value={draftFilters.endDate} onChange={(event) => setDraftFilters((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full rounded border border-mist bg-white px-2 py-1.5 text-xs font-normal text-slate-ink" />
                </label>
              </div>
            )}
            <button type="submit" disabled={loading} className="mt-3 inline-flex min-h-8 w-full items-center justify-center gap-2 rounded bg-white px-3 text-xs font-semibold text-deep-teal ring-1 ring-mist hover:bg-deep-teal hover:text-white disabled:opacity-50">
              <CalendarRange className="h-3.5 w-3.5" />Aplicar filtros
            </button>
          </form>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((conversation) => {
            const selected = conversation.customerId === selectedId;
            return <button key={conversation.customerId} type="button" onClick={() => void selectConversation(conversation.customerId)} className={`w-full border-b border-mist px-4 py-3.5 text-left transition ${selected ? "bg-deep-teal/[0.07]" : conversation.needsAttention ? "bg-amber-50/65 hover:bg-amber-50" : "hover:bg-pearl"}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${conversation.needsAttention ? "bg-burnt-coral text-white" : "bg-deep-teal/10 text-deep-teal"}`}>{initials(conversation.customerName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2"><strong className="truncate text-sm text-slate-ink">{conversation.customerName}</strong><time className={`shrink-0 text-[10px] ${conversation.needsAttention ? "font-bold text-burnt-coral" : "text-stone"}`}>{formatConversationTime(conversation.lastMessage.timestamp)}</time></span>
                  <span className="mt-1 flex items-center gap-1.5"><span className="truncate text-xs text-stone">{conversation.lastMessage.direction === "outbound" ? "Você: " : ""}{conversation.lastMessage.preview}</span>{conversation.needsAttention && <i title="Última mensagem do cliente aguardando ação" className="h-2.5 w-2.5 shrink-0 rounded-full bg-burnt-coral" />}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={conversation.serviceStatus} />
                    {!conversation.withinServiceWindow && <span className="rounded-full bg-stone/10 px-2 py-0.5 text-[10px] font-semibold text-stone">Fora da janela</span>}
                    {conversation.needsAttention && <span className="rounded-full bg-burnt-coral/10 px-2 py-0.5 text-[10px] font-bold text-burnt-coral">Responder</span>}
                    {conversation.resolvedUntilNextMessage && <span className="inline-flex items-center gap-1 rounded-full bg-stone/10 px-2 py-0.5 text-[10px] font-semibold text-stone"><CheckCheck className="h-3 w-3" />Resolvido</span>}
                  </span>
                </span>
              </div>
            </button>;
          })}
          {filtered.length === 0 && <p className="px-5 py-12 text-center text-sm text-stone">{conversations.length === 0 ? (filters.includeOutsideWindow ? "Nenhuma conversa foi encontrada no período." : "Nenhum chat está dentro da janela de atendimento.") : "Nenhuma conversa corresponde à pesquisa."}</p>}
        </div>
      </aside>

      <div className={`${mobileListVisible ? "hidden" : "flex"} min-h-0 min-w-0 flex-col overflow-hidden bg-pearl/40 lg:flex`}>
        {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        {!detail ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">{loading ? <p className="flex items-center gap-2 text-sm text-stone"><LoaderCircle className="h-4 w-4 animate-spin" />Carregando conversa...</p> : <p className="text-sm text-stone">Selecione uma conversa para abrir o atendimento.</p>}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="shrink-0 border-b border-mist bg-white p-4 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex min-w-0 items-start gap-2"><button type="button" onClick={() => setMobileListVisible(true)} aria-label="Voltar para conversas" className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-mist bg-white text-stone lg:hidden"><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-heading text-lg font-semibold text-slate-ink">{detail.customerName}</h2>{detail.needsAttention && <span className="rounded-full bg-burnt-coral/10 px-2 py-1 text-[10px] font-bold uppercase text-burnt-coral">Ação necessária</span>}</div><Link href={`/dashboard/clientes/${detail.customerId}`} className="mt-1 inline-block text-xs font-semibold text-deep-teal hover:underline">Abrir cadastro completo</Link></div></div>
                <CustomerServiceStatusControl customerId={detail.customerId} initialStatus={detail.serviceStatus} variant="compact" onStatusChange={updateStatus} />
              </div>
              {detail.needsAttention && detail.attentionMessageId && <div className="mt-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-start gap-2 text-xs font-semibold leading-5 text-amber-900"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />A última mensagem é do cliente e ainda precisa de uma decisão da equipe.</p><button type="button" onClick={() => void resolveAttention()} disabled={resolving} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-slate-ink px-3 text-xs font-semibold text-white disabled:opacity-50">{resolving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <UserRoundCheck className="h-3.5 w-3.5" />}Resolvido até nova mensagem</button></div>}
              {!detail.needsAttention && detail.attentionMessageId && <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-stone"><CheckCheck className="h-4 w-4" />Esta mensagem foi resolvida. Uma nova mensagem do cliente reabrirá a atenção.</p>}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <WhatsAppConversation key={detail.customerId} customerId={detail.customerId} initialMessages={detail.messages} availability={detail.availability} onSent={() => window.setTimeout(() => void refresh(detail.customerId, true), 500)} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
}

function getDefaultDates() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return month && day ? `${day}/${month}` : value;
}

function localDateStart(value: string) {
  return new Date(`${value}T00:00:00`);
}

function localDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999`);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR") || "?";
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const labels: Record<ServiceStatus, string> = {
    ai_active: "IA ativa",
    waiting_human: "Aguardando equipe",
    human_active: "Equipe ativa",
    closed: "Encerrado",
  };
  return <span className="inline-flex items-center gap-1 rounded-full bg-deep-teal/10 px-2 py-0.5 text-[10px] font-semibold text-deep-teal"><Clock3 className="h-3 w-3" />{labels[status]}</span>;
}
