"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Clock3, Plus, Trash2, TriangleAlert, UserRound } from "lucide-react";

interface Appointment {
  _id: string;
  providerId: string;
  customerName: string;
  startAt: string;
  endAt: string;
  status: "scheduled" | "cancelled" | "completed";
  eventType?: string;
}

interface EventTypeDefinition {
  key: string;
  name: string;
  color: string;
}

interface ResourceDefinition {
  id: string;
  name: string;
}

interface CalendarAccessEvent {
  _id: string;
  type: "permission" | "blocker";
  title: string;
  startAt: string;
  endAt: string;
  resourceIds: string[];
}

const dayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const visibleAppointmentsPerDay = 5;

export default function WeekCalendar({
  timezone,
  eventTypes,
  resources,
  refreshKey,
  onCreateEvent,
}: {
  timezone: string;
  eventTypes: EventTypeDefinition[];
  resources: ResourceDefinition[];
  refreshKey: number;
  onCreateEvent: (date: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart(timezone));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [accessEvents, setAccessEvents] = useState<CalendarAccessEvent[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => getTodayIndex(getCurrentWeekStart(timezone), timezone));
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [showAppointments, setShowAppointments] = useState(true);
  const [showPermissions, setShowPermissions] = useState(true);
  const [showBlockers, setShowBlockers] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  useEffect(() => {
    let active = true;
    const fromDate = toDateKey(weekStart);
    const toDate = toDateKey(addDays(weekStart, 6));
    void fetch(`/api/calendar?mode=week&fromDate=${fromDate}&toDate=${toDate}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as {
          appointments?: Appointment[];
          accessEvents?: CalendarAccessEvent[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar a semana.");
        if (!active) return;
        setError("");
        setAppointments(data.appointments ?? []);
        setAccessEvents(data.accessEvents ?? []);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Falha ao carregar a semana.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [weekStart, refreshKey]);

  const filteredAppointments = useMemo(() => appointments
    .filter((appointment) => showCancelled || appointment.status !== "cancelled")
    .filter((appointment) => !selectedResourceId || appointment.providerId === selectedResourceId)
    .sort((first, second) => new Date(first.startAt).getTime() - new Date(second.startAt).getTime()),
  [appointments, selectedResourceId, showCancelled]);

  const filteredAccessEvents = useMemo(() => accessEvents.filter((accessEvent) => (
    !selectedResourceId
    || accessEvent.resourceIds.length === 0
    || accessEvent.resourceIds.includes(selectedResourceId)
  )), [accessEvents, selectedResourceId]);

  const conflictIds = useMemo(() => findConflictIds(filteredAppointments), [filteredAppointments]);
  const visibleEventCount = showAppointments ? filteredAppointments.length : 0;

  function navigateTo(nextWeekStart: Date, focusToday = false) {
    setLoading(true);
    setExpandedDays(new Set());
    setWeekStart(nextWeekStart);
    setSelectedDayIndex(focusToday ? getTodayIndex(nextWeekStart, timezone) : 0);
  }

  function toggleExpandedDay(dateKey: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  async function deleteEvent(appointment: Appointment) {
    if (!window.confirm("Excluir este evento permanentemente? Esta ação não pode ser desfeita.")) return;
    setDeletingId(appointment._id);
    setError("");
    try {
      const response = await fetch(`/api/calendar/appointments/${appointment._id}?permanent=true`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível excluir o evento.");
      setAppointments((current) => current.filter((item) => item._id !== appointment._id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o evento.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section aria-labelledby="week-calendar-title" className="border-t border-mist pt-7">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-deep-teal">Agenda da semana</p>
          <h2 id="week-calendar-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">
            {formatWeekRange(days[0], days[6])}
          </h2>
          <p className="mt-1 text-xs text-stone" aria-live="polite">
            {visibleEventCount} {visibleEventCount === 1 ? "evento visível" : "eventos visíveis"}
            {selectedResourceId ? ` para ${getResourceName(selectedResourceId, resources)}` : " em toda a equipe"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-9 items-center gap-2 rounded-md border border-mist bg-white px-2.5 text-xs font-semibold text-slate-ink">
            <UserRound className="h-3.5 w-3.5 text-deep-teal" />
            <span className="sr-only">Filtrar por profissional</span>
            <select
              value={selectedResourceId}
              onChange={(event) => setSelectedResourceId(event.target.value)}
              className="max-w-[180px] bg-transparent py-2 outline-none"
              aria-label="Filtrar por profissional"
            >
              <option value="">Toda a equipe</option>
              {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </label>
          <div className="flex overflow-hidden rounded-md border border-mist bg-white">
            <button type="button" onClick={() => navigateTo(addDays(weekStart, -7))} className="flex h-9 w-9 items-center justify-center border-r border-mist text-slate-ink hover:bg-soft-ivory" aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => navigateTo(getCurrentWeekStart(timezone), true)} className="px-3 text-xs font-semibold text-slate-ink hover:bg-soft-ivory">Hoje</button>
            <button type="button" onClick={() => navigateTo(addDays(weekStart, 7))} className="flex h-9 w-9 items-center justify-center border-l border-mist text-slate-ink hover:bg-soft-ivory" aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-mist bg-soft-ivory px-3 py-2.5">
        <Toggle label="Eventos" checked={showAppointments} onChange={setShowAppointments} color="teal" />
        <Toggle label="Permissões" checked={showPermissions} onChange={setShowPermissions} color="green" />
        <Toggle label="Bloqueios" checked={showBlockers} onChange={setShowBlockers} color="coral" />
        <Toggle label="Cancelados" checked={showCancelled} onChange={setShowCancelled} color="stone" />
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-burnt-coral">{error}</p>}

      <div className="mt-4 grid grid-cols-7 gap-1 rounded-lg border border-mist bg-white p-1 lg:hidden" aria-label="Escolha o dia">
        {days.map((day, index) => {
          const dateKey = toDateKey(day);
          const count = showAppointments ? filteredAppointments.filter((item) => getDateKey(item.startAt, timezone) === dateKey).length : 0;
          const selected = index === selectedDayIndex;
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => setSelectedDayIndex(index)}
              className={`min-w-0 rounded-md px-1 py-2 text-center transition-colors ${selected ? "bg-deep-teal text-white" : "text-stone hover:bg-soft-ivory"}`}
              aria-pressed={selected}
              aria-label={`${dayFormatter.format(day)}, dia ${day.getDate()}, ${count} eventos`}
            >
              <span className="block truncate text-[10px] font-semibold uppercase">{dayFormatter.format(day).replace(".", "")}</span>
              <span className="mt-0.5 block text-sm font-bold">{day.getDate()}</span>
              <span className={`mx-auto mt-1 block w-fit min-w-4 rounded-full px-1 text-[9px] font-bold ${selected ? "bg-white/20" : "bg-mist text-slate-ink"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-mist bg-white lg:mt-4 lg:overflow-x-auto">
        <div className="grid grid-cols-1 lg:min-w-[1050px] lg:grid-cols-7 lg:divide-x lg:divide-mist">
          {days.map((day, dayIndex) => {
            const dateKey = toDateKey(day);
            const dayAppointments = showAppointments
              ? filteredAppointments.filter((item) => getDateKey(item.startAt, timezone) === dateKey)
              : [];
            const dayAccessEvents = filteredAccessEvents.filter((item) => (
              accessEventTouchesDate(item, dateKey, timezone)
              && (item.type === "permission" ? showPermissions : showBlockers)
            ));
            const isToday = dateKey === toDateKey(getToday(timezone));
            const isExpanded = expandedDays.has(dateKey);
            const displayedAppointments = isExpanded ? dayAppointments : dayAppointments.slice(0, visibleAppointmentsPerDay);
            const hiddenAppointmentCount = dayAppointments.length - displayedAppointments.length;

            return (
              <div key={dateKey} className={`${dayIndex === selectedDayIndex ? "block" : "hidden"} min-w-0 bg-white lg:block lg:min-h-[430px]`}>
                <div className={`flex items-center justify-between gap-3 border-b border-mist px-3 py-3 ${isToday ? "bg-deep-teal/5" : "bg-soft-ivory"}`}>
                  <div className="flex items-baseline gap-2 lg:block">
                    <p className="text-xs font-semibold uppercase text-stone">{dayFormatter.format(day).replace(".", "")}</p>
                    <p className={`text-lg font-bold lg:mt-1 ${isToday ? "text-deep-teal" : "text-slate-ink"}`}>{day.getDate()}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${dayAppointments.length > 0 ? "bg-deep-teal/10 text-deep-teal" : "bg-mist/70 text-stone"}`}>
                    {dayAppointments.length}
                  </span>
                </div>

                <div className="space-y-2 p-2.5">
                  {loading && <p className="py-10 text-center text-xs text-stone">Carregando…</p>}

                  {!loading && dayAccessEvents.length > 0 && (
                    <div className="space-y-1.5 border-b border-mist pb-2">
                      {dayAccessEvents.slice(0, 2).map((accessEvent) => (
                        <article key={accessEvent._id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${accessEvent.type === "permission" ? "bg-emerald-50 text-emerald-800" : "bg-burnt-coral/5 text-burnt-coral"}`}>
                          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${accessEvent.type === "permission" ? "bg-emerald-500" : "bg-burnt-coral"}`} />
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-bold">{accessEvent.title}</p>
                            <p className="text-[9px] opacity-80">{formatTime(accessEvent.startAt, timezone)}–{formatTime(accessEvent.endAt, timezone)}</p>
                          </div>
                        </article>
                      ))}
                      {dayAccessEvents.length > 2 && <p className="px-2 text-[10px] font-semibold text-stone">+ {dayAccessEvents.length - 2} regras neste dia</p>}
                    </div>
                  )}

                  {!loading && displayedAppointments.map((appointment) => {
                    const definition = eventTypes.find((eventType) => eventType.key === appointment.eventType) ?? eventTypes[0];
                    const color = definition?.color ?? "#0F766E";
                    const hasConflict = conflictIds.has(appointment._id);
                    return (
                      <article
                        key={appointment._id}
                        className={`group min-w-0 rounded-md border border-mist border-l-[3px] bg-white px-2.5 py-2 shadow-sm ${appointment.status === "cancelled" ? "opacity-60" : ""}`}
                        style={{ borderLeftColor: color }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1 text-[11px] font-bold" style={{ color }}>
                              <Clock3 className="h-3 w-3 shrink-0" />
                              {formatTime(appointment.startAt, timezone)}–{formatTime(appointment.endAt, timezone)}
                            </p>
                            <p className="mt-1 truncate text-xs font-semibold text-slate-ink" title={appointment.customerName || "Sem cliente"}>{appointment.customerName || "Sem cliente"}</p>
                          </div>
                          <button type="button" onClick={() => deleteEvent(appointment)} disabled={deletingId === appointment._id} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-stone hover:bg-burnt-coral/10 hover:text-burnt-coral disabled:opacity-40" aria-label={`Excluir evento de ${appointment.customerName || "sem cliente"}`} title="Excluir evento">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-stone">{definition?.name ?? "Tipo removido"} · {getResourceName(appointment.providerId, resources)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <StatusBadge status={appointment.status} />
                          {hasConflict && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800" title="Há outro evento deste profissional no mesmo horário">
                              <TriangleAlert className="h-2.5 w-2.5" />Conflito
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  {!loading && hiddenAppointmentCount > 0 && (
                    <button type="button" onClick={() => toggleExpandedDay(dateKey)} className="flex min-h-9 w-full items-center justify-center gap-1 rounded-md bg-deep-teal/5 px-2 text-xs font-semibold text-deep-teal hover:bg-deep-teal/10">
                      <ChevronDown className="h-3.5 w-3.5" />Mostrar mais {hiddenAppointmentCount}
                    </button>
                  )}
                  {!loading && isExpanded && dayAppointments.length > visibleAppointmentsPerDay && (
                    <button type="button" onClick={() => toggleExpandedDay(dateKey)} className="min-h-8 w-full text-xs font-semibold text-stone hover:text-deep-teal">Mostrar menos</button>
                  )}

                  {!loading && dayAppointments.length === 0 && dayAccessEvents.length === 0 && (
                    <div className="py-6 text-center">
                      <p className="text-xs font-medium text-stone">Dia livre</p>
                      <p className="mt-1 text-[10px] text-stone/80">Nenhum evento com os filtros atuais.</p>
                    </div>
                  )}

                  {!loading && (
                    <button type="button" onClick={() => onCreateEvent(dateKey)} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-mist px-2 text-xs font-semibold text-deep-teal hover:border-deep-teal/40 hover:bg-deep-teal/5">
                      <Plus className="h-3.5 w-3.5" />Criar evento
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: (checked: boolean) => void; color: "teal" | "green" | "coral" | "stone" }) {
  const activeColor = color === "teal"
    ? "bg-deep-teal"
    : color === "green"
      ? "bg-emerald-500"
      : color === "coral"
        ? "bg-burnt-coral"
        : "bg-stone";
  return (
    <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-ink">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? activeColor : "bg-mist"}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
      {label}
    </label>
  );
}

function StatusBadge({ status }: { status: Appointment["status"] }) {
  const style = status === "scheduled"
    ? "bg-sky-50 text-sky-700"
    : status === "cancelled"
      ? "bg-slate-100 text-stone"
      : "bg-emerald-50 text-emerald-700";
  return <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${style}`}>{formatAppointmentStatus(status)}</span>;
}

function getCurrentWeekStart(timezone: string) {
  const today = getToday(timezone);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  return addDays(today, -daysSinceMonday);
}

function getTodayIndex(weekStart: Date, timezone: string) {
  const todayKey = toDateKey(getToday(timezone));
  const index = Array.from({ length: 7 }, (_, dayIndex) => toDateKey(addDays(weekStart, dayIndex))).indexOf(todayKey);
  return index >= 0 ? index : 0;
}

function getToday(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day), 12);
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function formatWeekRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)} de ${end.getFullYear()}`;
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function accessEventTouchesDate(event: CalendarAccessEvent, dateKey: string, timezone: string) {
  const startDate = getDateKey(event.startAt, timezone);
  const end = new Date(new Date(event.endAt).getTime() - 1);
  const endDate = getDateKey(end.toISOString(), timezone);
  return startDate <= dateKey && endDate >= dateKey;
}

function formatAppointmentStatus(status: Appointment["status"]) {
  if (status === "scheduled") return "Agendado";
  if (status === "cancelled") return "Cancelado";
  return "Concluído";
}

function getResourceName(resourceId: string, resources: ResourceDefinition[]) {
  return resources.find((resource) => resource.id === resourceId)?.name || resourceId || "Profissional";
}

function findConflictIds(appointments: Appointment[]) {
  const conflicts = new Set<string>();
  const activeAppointments = appointments.filter((appointment) => appointment.status !== "cancelled");

  for (let firstIndex = 0; firstIndex < activeAppointments.length; firstIndex += 1) {
    const first = activeAppointments[firstIndex];
    const firstStart = new Date(first.startAt).getTime();
    const firstEnd = new Date(first.endAt).getTime();

    for (let secondIndex = firstIndex + 1; secondIndex < activeAppointments.length; secondIndex += 1) {
      const second = activeAppointments[secondIndex];
      if (first.providerId !== second.providerId) continue;

      const secondStart = new Date(second.startAt).getTime();
      if (secondStart >= firstEnd) break;
      const secondEnd = new Date(second.endAt).getTime();
      if (firstStart < secondEnd && secondStart < firstEnd) {
        conflicts.add(first._id);
        conflicts.add(second._id);
      }
    }
  }

  return conflicts;
}
