"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Clock3,
  ListFilter,
  MessageCircle,
  Pencil,
  Repeat2,
  Search,
  Trash2,
} from "lucide-react";
import { getEffectiveDayWindows, type EffectiveDayInterval } from "@/lib/calendar/effective-windows";

interface Appointment {
  _id: string;
  providerId: string;
  customerId?: string;
  customerName: string;
  contactPhone?: string;
  startAt: string;
  endAt: string;
  status: "held" | "scheduled" | "cancelled" | "completed";
  eventType?: string;
  customTitle?: string;
  confirmationStatus?: "pending" | "confirmed";
  notes?: string;
  source: "assistant" | "manual";
  recurrence?: {
    seriesId: string;
    frequency: "daily" | "weekly" | "monthly";
    interval: number;
    occurrenceIndex: number;
    totalOccurrences: number;
    originalStartAt: string;
    isException?: boolean;
  };
}

interface EventTypeDefinition {
  key: string;
  name: string;
  color: string;
  durationMinutes: number;
}

interface ResourceDefinition {
  id: string;
  name: string;
  weeklyAvailability: Array<{
    weekday: number;
    enabled: boolean;
    intervals: Array<{ startTime: string; endTime: string }>;
  }>;
}

interface AccessEvent {
  _id: string;
  type: "permission" | "blocker";
  startAt: string;
  endAt: string;
  resourceIds: string[];
}

type ViewMode = "week" | "month";
interface ResourceDayWindows {
  resourceId: string;
  resourceName: string;
  intervals: EffectiveDayInterval[];
}

export default function WeekCalendar({
  timezone,
  eventTypes,
  resources,
  refreshKey,
  onEditEvent,
  onOpenWhatsApp,
  onSetConfirmation,
  onCancelEvent,
  onDeleteEvent,
  busy,
}: {
  timezone: string;
  eventTypes: EventTypeDefinition[];
  resources: ResourceDefinition[];
  slotDurationMinutes: number;
  refreshKey: number;
  onEditEvent: (appointment: Appointment) => void;
  onOpenWhatsApp: (appointment: Appointment) => void | Promise<void>;
  onSetConfirmation: (id: string, status: "pending" | "confirmed") => void | Promise<void>;
  onCancelEvent: (appointment: Appointment) => void | Promise<void>;
  onDeleteEvent: (appointment: Appointment) => void | Promise<void>;
  busy: boolean;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selectedDate, setSelectedDate] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [accessEvents, setAccessEvents] = useState<AccessEvent[]>([]);
  const [query, setQuery] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(query);
  const period = useMemo(() => getVisiblePeriod(cursor, viewMode), [cursor, viewMode]);

  useEffect(() => {
    let active = true;
    const parameters = new URLSearchParams({
      mode: "period",
      fromDate: toDateKey(period.start),
      toDate: toDateKey(period.end),
    });
    void fetch(`/api/calendar?${parameters}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as {
          appointments?: Appointment[];
          accessEvents?: AccessEvent[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar o período.");
        if (!active) return;
        setAppointments(data.appointments ?? []);
        setAccessEvents(data.accessEvents ?? []);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o período.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [period.end, period.start, refreshKey]);

  const normalizedQuery = normalize(deferredQuery);
  const filteredAppointments = useMemo(() => appointments
    .filter((appointment) => !selectedDate || dateKeyInTimezone(appointment.startAt, timezone) === selectedDate)
    .filter((appointment) => !resourceId || appointment.providerId === resourceId)
    .filter((appointment) => !eventType || appointment.eventType === eventType)
    .filter((appointment) => matchesStatus(appointment, status))
    .filter((appointment) => {
      if (!normalizedQuery) return true;
      return normalize([
        appointment.customerName,
        appointment.contactPhone,
        appointment.notes,
        appointment.customTitle,
        eventTypes.find((item) => item.key === appointment.eventType)?.name,
      ].filter(Boolean).join(" ")).includes(normalizedQuery);
    })
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)),
  [appointments, eventType, eventTypes, normalizedQuery, resourceId, selectedDate, status, timezone]);

  const countsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const appointment of appointments) {
      if (appointment.status === "cancelled") continue;
      const key = dateKeyInTimezone(appointment.startAt, timezone);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [appointments, timezone]);
  const windowsByDay = useMemo(() => new Map(period.days.map((day) => {
    const key = toDateKey(day);
    const resourceWindows: ResourceDayWindows[] = resources.map((resource) => ({
      resourceId: resource.id,
      resourceName: resource.name,
      intervals: getEffectiveDayWindows(key, timezone, resource, accessEvents),
    }));
    return [key, resourceWindows] as const;
  })), [accessEvents, period.days, resources, timezone]);
  const todayKey = dateKeyInTimezone(new Date().toISOString(), timezone);
  const detailDateKey = selectedDate || (windowsByDay.has(todayKey) ? todayKey : toDateKey(cursor));
  const detailWindows = windowsByDay.get(detailDateKey) ?? [];
  const hasListFilters = Boolean(query || resourceId || eventType || status);

  function movePeriod(direction: -1 | 1) {
    setLoading(true);
    setCursor((current) => (
      viewMode === "month"
        ? addMonths(current, direction)
        : addDays(current, direction * 7)
    ));
    setSelectedDate("");
  }

  function focusToday() {
    setLoading(true);
    setCursor(startOfDay(new Date()));
    setSelectedDate(todayKey);
  }

  function clearListFilters() {
    setQuery("");
    setResourceId("");
    setEventType("");
    setStatus("");
  }

  return (
    <section aria-labelledby="compact-calendar-title" className="overflow-hidden rounded-xl border border-mist bg-white shadow-sm">
      <header className="flex flex-col gap-4 border-b border-mist p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-deep-teal">Agenda compacta</p>
          <h2 id="compact-calendar-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">
            {formatPeriodTitle(cursor, viewMode)}
          </h2>
          <p className="mt-1 text-xs text-stone">Selecione um dia para focar a tabela. Os números indicam eventos não cancelados.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-mist">
            <button type="button" onClick={() => { setLoading(true); setViewMode("week"); setSelectedDate(""); }} className={`min-h-9 px-3 text-xs font-semibold ${viewMode === "week" ? "bg-deep-teal text-white" : "bg-white text-stone"}`}>Semana</button>
            <button type="button" onClick={() => { setLoading(true); setViewMode("month"); setSelectedDate(""); }} className={`min-h-9 px-3 text-xs font-semibold ${viewMode === "month" ? "bg-deep-teal text-white" : "bg-white text-stone"}`}>Mês</button>
          </div>
          <button type="button" onClick={() => movePeriod(-1)} aria-label="Período anterior" className="flex h-9 w-9 items-center justify-center rounded-md border border-mist text-stone hover:text-deep-teal"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={focusToday} className="min-h-9 rounded-md border border-mist px-3 text-xs font-semibold text-slate-ink">Hoje</button>
          <button type="button" onClick={() => movePeriod(1)} aria-label="Próximo período" className="flex h-9 w-9 items-center justify-center rounded-md border border-mist text-stone hover:text-deep-teal"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="grid gap-0 2xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
        <div className="border-b border-mist p-4 2xl:border-b-0 2xl:border-r">
          <div className="grid gap-4 lg:grid-cols-[minmax(320px,480px)_minmax(280px,1fr)] 2xl:grid-cols-1">
            <div>
              <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase text-stone">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <span key={day} className="py-2">{day}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {period.days.map((day) => {
                  const key = toDateKey(day);
                  const count = countsByDay.get(key) ?? 0;
                  const selected = selectedDate === key;
                  const isToday = key === todayKey;
                  const dayWindows = windowsByDay.get(key) ?? [];
                  const canAttend = dayWindows.some((resource) => resource.intervals.length > 0);
                  const outsideMonth = viewMode === "month" && day.getMonth() !== cursor.getMonth();
                  return <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDate((current) => current === key ? "" : key)}
                    aria-label={`${formatCalendarDayLabel(key)}: ${canAttend ? "há janela efetiva de atendimento" : "sem janela efetiva"}${count > 0 ? `, ${count} eventos` : ""}`}
                    title={canAttend ? "Há janela efetiva de atendimento" : "Sem janela efetiva de atendimento"}
                    className={`relative flex min-h-14 flex-col items-center justify-center rounded-md border text-xs transition ${selected ? "border-deep-teal bg-deep-teal text-white" : canAttend ? "border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100" : "border-red-100 bg-red-50 text-red-900 hover:bg-red-100"} ${outsideMonth && !selected ? "opacity-45" : ""} ${isToday ? "outline outline-2 outline-offset-1 outline-deep-teal" : ""}`}
                  >
                    {isToday && <span className={`absolute top-0.5 text-[7px] font-bold uppercase ${selected ? "text-white/80" : "text-deep-teal"}`}>Hoje</span>}
                    <span className="font-semibold">{day.getDate()}</span>
                    {count > 0 && <span className={`mt-0.5 inline-flex min-w-5 justify-center rounded-full px-1 text-[9px] font-bold ${selected ? "bg-white/20 text-white" : "bg-burnt-coral/10 text-burnt-coral"}`}>{count}</span>}
                    <span className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${selected ? "bg-white" : canAttend ? "bg-emerald-600" : "bg-red-500"}`} aria-hidden="true" />
                  </button>;
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-stone">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" />Com janela efetiva</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />Sem janela efetiva</span>
              </div>
            </div>
            <section aria-labelledby="effective-windows-title" className="rounded-lg border border-mist bg-soft-ivory/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-deep-teal">Janelas efetivas</p>
                <h3 id="effective-windows-title" className="mt-0.5 text-xs font-semibold text-slate-ink">{formatCalendarDayLabel(detailDateKey)}</h3>
              </div>
              {selectedDate && selectedDate !== todayKey && <button type="button" onClick={focusToday} className="inline-flex items-center gap-1 text-[10px] font-semibold text-deep-teal hover:underline"><CalendarDays className="h-3 w-3" />Ir para hoje</button>}
            </div>
            <div className="mt-3 space-y-2">
              {detailWindows.map((resource) => {
                const allowed = resource.intervals.length > 0;
                return <div key={resource.resourceId} className="rounded-md bg-white px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-ink">{resource.resourceName}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${allowed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{allowed ? "Permitido" : "Sem janela"}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-stone">{allowed ? resource.intervals.map((interval) => `${interval.startTime}–${interval.endTime}`).join(", ") : "Expediente, permissões e bloqueios não deixam intervalo livre."}</p>
                </div>;
              })}
            </div>
            </section>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid gap-2 border-b border-mist p-4 md:grid-cols-[minmax(200px,1fr)_150px_160px_150px]">
            <label className="relative">
              <span className="sr-only">Pesquisar eventos</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, telefone ou observação" className="w-full rounded-md border border-mist py-2.5 pl-9 pr-3 text-sm outline-none focus:border-deep-teal" />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por situação" className="rounded-md border border-mist px-3 py-2 text-sm">
              <option value="">Situações</option>
              <option value="pending">A confirmar</option>
              <option value="confirmed">Confirmados</option>
              <option value="held">Aguardando sinal</option>
              <option value="completed">Concluídos</option>
              <option value="cancelled">Cancelados</option>
            </select>
            <select value={eventType} onChange={(event) => setEventType(event.target.value)} aria-label="Filtrar por tipo" className="rounded-md border border-mist px-3 py-2 text-sm">
              <option value="">Tipos de evento</option>
              {eventTypes.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
              <option value="custom">Personalizado</option>
            </select>
            <select value={resourceId} onChange={(event) => setResourceId(event.target.value)} aria-label="Filtrar por profissional" className="rounded-md border border-mist px-3 py-2 text-sm">
              <option value="">Profissionais</option>
              {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </div>

          {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mist px-4 py-2.5 text-xs text-stone">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5"><ListFilter className="h-3.5 w-3.5" />{filteredAppointments.length} eventos</span>
              {selectedDate && <span className="rounded-full bg-deep-teal/10 px-2 py-1 font-semibold text-deep-teal">{formatShortDate(selectedDate)}</span>}
            </div>
            <div className="flex items-center gap-3">
              {selectedDate && <button type="button" onClick={() => setSelectedDate("")} className="font-semibold text-deep-teal hover:underline">Mostrar período</button>}
              {hasListFilters && <button type="button" onClick={clearListFilters} className="font-semibold text-deep-teal hover:underline">Limpar filtros</button>}
              {loading && <span>Atualizando…</span>}
            </div>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[720px] table-fixed text-left text-sm xl:min-w-[860px]">
              <colgroup>
                <col className="w-32" />
                <col className="w-40" />
                <col />
                <col className="hidden w-36 xl:table-column" />
                <col className="w-28" />
                <col className="w-44" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-soft-ivory text-[10px] font-semibold uppercase text-stone">
                <tr><th className="px-3 py-3">Data e hora</th><th className="px-3 py-3">Cliente</th><th className="px-3 py-3">Evento</th><th className="hidden px-3 py-3 xl:table-cell">Profissional</th><th className="px-3 py-3">Situação</th><th className="sticky right-0 z-20 bg-soft-ivory px-3 py-3 text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">Ações</th></tr>
              </thead>
              <tbody className="divide-y divide-mist">
                {filteredAppointments.map((appointment) => {
                  const appointmentRange = formatAppointmentRange(appointment.startAt, appointment.endAt, timezone);
                  return <tr key={appointment._id} className="group hover:bg-soft-ivory/50">
                    <td className="px-3 py-3 text-slate-ink" title={appointmentRange.fullLabel}>
                      <span className="block whitespace-nowrap font-semibold">{appointmentRange.dateLabel}</span>
                      <span className="mt-1 block whitespace-nowrap text-xs text-stone">{appointmentRange.timeLabel}</span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-deep-teal">{appointmentRange.durationLabel}</span>
                    </td>
                    <td className="truncate px-3 py-3 text-slate-ink">{appointment.customerName || "Sem cliente"}</td>
                    <td className="min-w-0 px-3 py-3">
                      <span className="block truncate font-medium text-slate-ink">{appointment.customTitle || eventTypes.find((item) => item.key === appointment.eventType)?.name || "Tipo removido"}</span>
                      <span className="mt-1 block truncate text-[10px] text-stone xl:hidden">{resources.find((resource) => resource.id === appointment.providerId)?.name ?? "Profissional removido"}</span>
                      {appointment.recurrence && <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-deep-teal"><Repeat2 className="h-3 w-3" />{recurrenceLabel(appointment.recurrence)}</span>}
                      {appointment.notes && <span className="mt-1 block max-w-56 truncate text-xs text-stone">{appointment.notes}</span>}
                    </td>
                    <td className="hidden truncate px-3 py-3 text-stone xl:table-cell">{resources.find((resource) => resource.id === appointment.providerId)?.name ?? "Profissional removido"}</td>
                    <td className="px-3 py-3"><StatusBadge appointment={appointment} /></td>
                    <td className="sticky right-0 bg-white px-3 py-3 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)] group-hover:bg-soft-ivory">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        {(appointment.customerId || appointment.contactPhone) && <button type="button" onClick={() => void onOpenWhatsApp(appointment)} disabled={busy} aria-label="Abrir WhatsApp Web" title="Consultar o telefone atual do cadastro e abrir o WhatsApp Web" className="flex h-8 w-8 items-center justify-center rounded text-emerald-700 hover:bg-emerald-50 disabled:opacity-30"><MessageCircle className="h-4 w-4" /></button>}
                        {isPendingConfirmation(appointment)
                          ? <button type="button" onClick={() => void onSetConfirmation(appointment._id, "confirmed")} disabled={busy} aria-label="Confirmar evento" title="Confirmar evento" className="flex h-8 w-8 items-center justify-center rounded text-deep-teal hover:bg-deep-teal/5 disabled:opacity-30"><Check className="h-4 w-4" /></button>
                          : appointment.status === "scheduled" && <button type="button" onClick={() => void onSetConfirmation(appointment._id, "pending")} disabled={busy} aria-label="Marcar como pendente" title="Marcar como pendente" className="flex h-8 w-8 items-center justify-center rounded text-amber-700 hover:bg-amber-50 disabled:opacity-30"><Clock3 className="h-4 w-4" /></button>}
                        <button type="button" onClick={() => onEditEvent(appointment)} disabled={appointment.status === "cancelled" || appointment.status === "completed"} aria-label="Editar evento" className="flex h-8 w-8 items-center justify-center rounded text-stone hover:bg-deep-teal/5 hover:text-deep-teal disabled:opacity-30"><Pencil className="h-4 w-4" /></button>
                        {appointment.status === "scheduled" && <button type="button" onClick={() => void onCancelEvent(appointment)} disabled={busy} aria-label="Cancelar evento" title="Cancelar evento" className="flex h-8 w-8 items-center justify-center rounded text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-30"><CircleOff className="h-4 w-4" /></button>}
                        <button type="button" onClick={() => void onDeleteEvent(appointment)} disabled={busy} aria-label="Excluir evento" title="Excluir permanentemente" className="flex h-8 w-8 items-center justify-center rounded text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
            {!loading && filteredAppointments.length === 0 && <p className="px-5 py-12 text-center text-sm text-stone">Nenhum evento corresponde ao período e aos filtros.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function getVisiblePeriod(cursor: Date, viewMode: ViewMode) {
  if (viewMode === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    return { start, end, days: Array.from({ length: 7 }, (_, index) => addDays(start, index)) };
  }
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  return { start, end: days[41], days };
}

function startOfWeek(value: Date) {
  const date = startOfDay(value);
  return addDays(date, -date.getDay());
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function toDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dateKeyInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatPeriodTitle(cursor: Date, mode: ViewMode) {
  if (mode === "month") {
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(cursor);
  }
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  return `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(start)} – ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(end)}`;
}

function formatCalendarDayLabel(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function formatShortDate(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function formatAppointmentRange(startValue: string, endValue: string, timezone: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  const sameDay = dateKeyInTimezone(startValue, timezone) === dateKeyInTimezone(endValue, timezone);
  const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const startDate = dateFormatter.format(start);
  const endDate = dateFormatter.format(end);
  const startTime = timeFormatter.format(start);
  const endTime = timeFormatter.format(end);
  return {
    dateLabel: sameDay ? startDate : `${startDate} ${startTime}`,
    timeLabel: sameDay ? `${startTime}–${endTime}` : `→ ${endDate} ${endTime}`,
    durationLabel: formatDuration(durationMinutes),
    fullLabel: `${startDate} ${startTime} até ${endDate} ${endTime} (${formatDuration(durationMinutes)})`,
  };
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h${String(remainder).padStart(2, "0")}` : `${hours}h`;
}

function matchesStatus(appointment: Appointment, status: string) {
  if (!status) return appointment.status !== "cancelled";
  if (status === "pending") {
    return isPendingConfirmation(appointment);
  }
  if (status === "confirmed") {
    return appointment.status === "scheduled"
      && !(appointment.confirmationStatus === "pending" || (!appointment.confirmationStatus && appointment.source === "manual"));
  }
  return appointment.status === status;
}

function isPendingConfirmation(appointment: Appointment) {
  return appointment.status === "scheduled"
    && (appointment.confirmationStatus === "pending" || (!appointment.confirmationStatus && appointment.source === "manual"));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
}

function recurrenceLabel(recurrence: NonNullable<Appointment["recurrence"]>) {
  if (recurrence.frequency === "monthly") {
    return recurrence.interval === 1
      ? "Repete a cada 4 semanas"
      : `Repete a cada ${recurrence.interval * 4} semanas`;
  }
  if (recurrence.frequency === "weekly" && recurrence.interval === 2) {
    return "Repete quinzenalmente";
  }
  const frequency = recurrence.frequency === "daily" ? "dia" : "semana";
  return recurrence.interval === 1
    ? `Repete a cada ${frequency}`
    : `Repete a cada ${recurrence.interval} ${frequency}s`;
}

function StatusBadge({ appointment }: { appointment: Appointment }) {
  const pending = appointment.status === "scheduled"
    && (appointment.confirmationStatus === "pending" || (!appointment.confirmationStatus && appointment.source === "manual"));
  const label = appointment.status === "held"
    ? "Aguardando sinal"
    : appointment.status === "cancelled"
      ? "Cancelado"
      : appointment.status === "completed"
        ? "Concluído"
        : pending ? "A confirmar" : "Confirmado";
  const tone = appointment.status === "cancelled"
    ? "bg-stone/10 text-stone"
    : pending || appointment.status === "held"
      ? "bg-amber-100 text-amber-800"
      : "bg-emerald-100 text-emerald-800";
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${tone}`}>{label}</span>;
}
