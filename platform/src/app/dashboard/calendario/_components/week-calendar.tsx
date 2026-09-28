"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Pencil, Search, Trash2, TriangleAlert, UserRound } from "lucide-react";

interface Appointment {
  _id: string;
  providerId: string;
  customerId?: string;
  customerName: string;
  contactPhone?: string;
  startAt: string;
  endAt: string;
  status: "held" | "scheduled" | "cancelled" | "completed";
  holdExpiresAt?: string;
  eventType?: string;
  customTitle?: string;
  durationMinutes?: number;
  confirmationStatus?: "pending" | "confirmed";
  notes?: string;
  source: "assistant" | "manual";
}

interface EventTypeDefinition {
  key: string;
  name: string;
  color: string;
  durationMinutes: number;
}

interface DayAvailability {
  weekday: number;
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

interface ResourceDefinition {
  id: string;
  name: string;
  weeklyAvailability: DayAvailability[];
}

interface CalendarAccessEvent {
  _id: string;
  type: "permission" | "blocker";
  title: string;
  startAt: string;
  endAt: string;
  resourceIds: string[];
}

const hourHeight = 64;
const dayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const emptyAppointments: Appointment[] = [];
const emptyAccessEvents: CalendarAccessEvent[] = [];

function WeekCalendar({
  timezone,
  eventTypes,
  resources,
  slotDurationMinutes,
  refreshKey,
  onEditEvent,
}: {
  timezone: string;
  eventTypes: EventTypeDefinition[];
  resources: ResourceDefinition[];
  slotDurationMinutes: number;
  refreshKey: number;
  onEditEvent: (appointment: Appointment) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart(timezone));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [accessEvents, setAccessEvents] = useState<CalendarAccessEvent[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [eventQuery, setEventQuery] = useState("");
  const [selectedEventType, setSelectedEventType] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => getTodayIndex(getCurrentWeekStart(timezone), timezone));
  const [showPermissions, setShowPermissions] = useState(true);
  const [showBlockers, setShowBlockers] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const deferredEventQuery = useDeferredValue(eventQuery);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
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
        setAppointments(data.appointments ?? []);
        setAccessEvents(data.accessEvents ?? []);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Falha ao carregar a semana.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [weekStart, refreshKey]);

  const normalizedEventQuery = useMemo(() => normalizeSearch(deferredEventQuery), [deferredEventQuery]);
  const filteredAppointments = useMemo(() => appointments
    .filter((appointment) => showCancelled || selectedStatus === "cancelled" || appointment.status !== "cancelled")
    .filter((appointment) => !selectedResourceId || appointment.providerId === selectedResourceId)
    .filter((appointment) => !selectedEventType || appointment.eventType === selectedEventType)
    .filter((appointment) => matchesAppointmentStatus(appointment, selectedStatus))
    .filter((appointment) => {
      if (!normalizedEventQuery) return true;
      const eventTypeName = eventTypes.find((eventType) => eventType.key === appointment.eventType)?.name ?? "";
      return normalizeSearch([
        appointment.customerName,
        appointment.contactPhone,
        appointment.notes,
        appointment.customTitle,
        eventTypeName,
      ].filter(Boolean).join(" ")).includes(normalizedEventQuery);
    })
    .sort((first, second) => new Date(first.startAt).getTime() - new Date(second.startAt).getTime()),
  [appointments, eventTypes, normalizedEventQuery, selectedEventType, selectedResourceId, selectedStatus, showCancelled]);

  const filteredAccessEvents = useMemo(() => accessEvents.filter((accessEvent) => (
    !selectedResourceId
    || accessEvent.resourceIds.length === 0
    || accessEvent.resourceIds.includes(selectedResourceId)
  )), [accessEvents, selectedResourceId]);

  const conflictIds = useMemo(() => findConflictIds(filteredAppointments), [filteredAppointments]);
  const { startHour, endHour } = useMemo(
    () => getTimelineBounds(days, filteredAppointments, resources, selectedResourceId, timezone),
    [days, filteredAppointments, resources, selectedResourceId, timezone],
  );
  const timelineHeight = (endHour - startHour) * hourHeight;
  const hourLabels = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const appointmentsByDay = useMemo(
    () => groupAppointmentsByDay(filteredAppointments, timezone),
    [filteredAppointments, timezone],
  );
  const accessEventsByDay = useMemo(
    () => groupAccessEventsByDay(filteredAccessEvents, days, timezone),
    [filteredAccessEvents, days, timezone],
  );

  const deleteEvent = useCallback(async (appointment: Appointment) => {
    if (!window.confirm("Excluir este evento permanentemente? Esta ação não pode ser desfeita.")) return;
    setDeletingId(appointment._id);
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
  }, []);

  function navigateTo(nextWeekStart: Date, focusToday = false) {
    setWeekStart(nextWeekStart);
    setSelectedDayIndex(focusToday ? getTodayIndex(nextWeekStart, timezone) : 0);
  }

  return (
    <section aria-labelledby="week-calendar-title" className="relative rounded-xl border border-mist bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-mist p-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-deep-teal">Agenda semanal</p>
          <h2 id="week-calendar-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">{formatWeekRange(days[0], days[6])}</h2>
          <p className="mt-1 text-xs text-stone">
            {filteredAppointments.length} eventos visíveis · {selectedResourceId ? "disponibilidade do profissional" : "interseção de disponibilidade de toda a equipe"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-9 items-center gap-2 rounded-md border border-mist bg-white px-2.5 text-xs font-semibold text-slate-ink">
            <UserRound className="h-3.5 w-3.5 text-deep-teal" />
            <select value={selectedResourceId} onChange={(event) => setSelectedResourceId(event.target.value)} className="max-w-[190px] bg-transparent py-2 outline-none" aria-label="Filtrar por profissional">
              <option value="">Toda a equipe</option>
              {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </label>
          <div className="flex overflow-hidden rounded-md border border-mist bg-white">
            <button type="button" onClick={() => navigateTo(addDays(weekStart, -7))} className="flex h-9 w-9 items-center justify-center border-r border-mist hover:bg-soft-ivory" aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => navigateTo(getCurrentWeekStart(timezone), true)} className="px-3 text-xs font-semibold hover:bg-soft-ivory">Hoje</button>
            <button type="button" onClick={() => navigateTo(addDays(weekStart, 7))} className="flex h-9 w-9 items-center justify-center border-l border-mist hover:bg-soft-ivory" aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 border-b border-mist px-4 py-3 md:grid-cols-[minmax(220px,1fr)_190px_180px]">
        <label className="relative">
          <span className="sr-only">Pesquisar eventos</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Cliente, observação ou evento" className="w-full rounded-md border border-mist bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-deep-teal" />
        </label>
        <select value={selectedEventType} onChange={(event) => setSelectedEventType(event.target.value)} className="rounded-md border border-mist bg-white px-3 py-2.5 text-sm outline-none focus:border-deep-teal" aria-label="Filtrar por tipo de evento">
          <option value="">Todos os tipos</option>
          {eventTypes.map((eventType) => <option key={eventType.key} value={eventType.key}>{eventType.name}</option>)}
          <option value="custom">Personalizados</option>
        </select>
        <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)} className="rounded-md border border-mist bg-white px-3 py-2.5 text-sm outline-none focus:border-deep-teal" aria-label="Filtrar por situação">
          <option value="">Todas as situações</option>
          <option value="pending">Agendado · confirmar</option>
          <option value="confirmed">Confirmados</option>
          <option value="held">Aguardando sinal</option>
          <option value="completed">Concluídos</option>
          <option value="cancelled">Cancelados</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-mist bg-soft-ivory/60 px-4 py-2.5">
        <Toggle label="Permissões" checked={showPermissions} onChange={setShowPermissions} />
        <Toggle label="Bloqueios" checked={showBlockers} onChange={setShowBlockers} />
        <Toggle label="Cancelados" checked={showCancelled} onChange={setShowCancelled} />
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[10px] font-medium text-stone">
          <Legend color="bg-emerald-200" label="Disponível" />
          <Legend color="bg-amber-100" label="Expediente sem permissão comum" />
          <Legend color="bg-red-100" label="Bloqueado" />
        </div>
      </div>

      {error && <p role="alert" className="m-4 text-sm text-burnt-coral">{error}</p>}

      <div className="grid grid-cols-7 border-b border-mist lg:hidden">
        {days.map((day, index) => (
          <button key={toDateKey(day)} type="button" onClick={() => setSelectedDayIndex(index)} className={`px-1 py-2 text-center ${selectedDayIndex === index ? "bg-deep-teal text-white" : "text-stone"}`}>
            <span className="block text-[9px] font-semibold uppercase">{dayFormatter.format(day).replace(".", "")}</span>
            <span className="block text-sm font-bold">{day.getDate()}</span>
          </button>
        ))}
      </div>

      <div className="max-h-[72vh] overflow-auto">
        <div className="min-w-0 lg:min-w-[1080px]">
          <div className="sticky top-0 z-30 hidden grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-mist bg-white lg:grid">
            <div className="border-r border-mist" />
            {days.map((day) => {
              const today = toDateKey(day) === toDateKey(getToday(timezone));
              return <div key={toDateKey(day)} className={`border-r border-mist px-2 py-3 text-center ${today ? "bg-deep-teal/5" : ""}`}><span className="text-[10px] font-semibold uppercase text-stone">{dayFormatter.format(day).replace(".", "")}</span><strong className={`ml-2 text-sm ${today ? "text-deep-teal" : "text-slate-ink"}`}>{day.getDate()}</strong></div>;
            })}
          </div>

          <div className="grid grid-cols-[52px_minmax(0,1fr)] lg:grid-cols-[64px_repeat(7,minmax(0,1fr))]">
            <div className="relative border-r border-mist bg-white" style={{ height: timelineHeight }}>
              {hourLabels.map((hour) => <span key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] text-stone" style={{ top: (hour - startHour) * hourHeight }}>{String(hour).padStart(2, "0")}:00</span>)}
            </div>
            {days.map((day, dayIndex) => (
              <TimelineDay
                key={toDateKey(day)}
                day={day}
                hiddenOnMobile={selectedDayIndex !== dayIndex}
                timezone={timezone}
                startHour={startHour}
                endHour={endHour}
                height={timelineHeight}
                slotDurationMinutes={slotDurationMinutes}
                resources={resources}
                selectedResourceId={selectedResourceId}
                appointments={appointmentsByDay.get(toDateKey(day)) ?? emptyAppointments}
                accessEvents={accessEventsByDay.get(toDateKey(day)) ?? emptyAccessEvents}
                showPermissions={showPermissions}
                showBlockers={showBlockers}
                eventTypes={eventTypes}
                conflictIds={conflictIds}
                deletingId={deletingId}
                onEditEvent={onEditEvent}
                onDeleteEvent={deleteEvent}
              />
            ))}
          </div>
        </div>
      </div>
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-stone">Carregando agenda...</div>}
    </section>
  );
}

const TimelineDay = memo(function TimelineDay({
  day,
  hiddenOnMobile,
  timezone,
  startHour,
  endHour,
  height,
  slotDurationMinutes,
  resources,
  selectedResourceId,
  appointments,
  accessEvents,
  showPermissions,
  showBlockers,
  eventTypes,
  conflictIds,
  deletingId,
  onEditEvent,
  onDeleteEvent,
}: {
  day: Date;
  hiddenOnMobile: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  height: number;
  slotDurationMinutes: number;
  resources: ResourceDefinition[];
  selectedResourceId: string;
  appointments: Appointment[];
  accessEvents: CalendarAccessEvent[];
  showPermissions: boolean;
  showBlockers: boolean;
  eventTypes: EventTypeDefinition[];
  conflictIds: Set<string>;
  deletingId: string;
  onEditEvent: (appointment: Appointment) => void;
  onDeleteEvent: (appointment: Appointment) => Promise<void>;
}) {
  const dateKey = toDateKey(day);
  const activeResources = useMemo(
    () => selectedResourceId ? resources.filter((resource) => resource.id === selectedResourceId) : resources,
    [resources, selectedResourceId],
  );
  const slots = useMemo(
    () => createTimeSlots(startHour, endHour, slotDurationMinutes),
    [startHour, endHour, slotDurationMinutes],
  );
  const slotStates = useMemo(() => slots.map((slot) => {
    const slotEnd = addMinutesToTime(slot, slotDurationMinutes);
    return {
      slot,
      state: getTeamSlotState({
      resources: activeResources,
      accessEvents,
      dateKey,
      day,
      timezone,
      start: slot,
      end: slotEnd,
      }),
    };
  }), [slots, slotDurationMinutes, activeResources, accessEvents, dateKey, day, timezone]);
  const visibleAccessEvents = useMemo(
    () => accessEvents.filter((event) => event.type === "permission" ? showPermissions : showBlockers),
    [accessEvents, showPermissions, showBlockers],
  );
  const accessEventLayouts = useMemo(
    () => layoutAccessEvents(visibleAccessEvents, dateKey, timezone),
    [visibleAccessEvents, dateKey, timezone],
  );

  return (
    <div className={`${hiddenOnMobile ? "hidden" : "block"} relative border-r border-mist bg-white lg:block`} style={{ height }}>
      {Array.from({ length: endHour - startHour + 1 }, (_, index) => (
        <div key={index} className="pointer-events-none absolute inset-x-0 border-t border-mist/70" style={{ top: index * hourHeight }} />
      ))}
      {slotStates.map(({ slot, state }) => {
        if (!state.configured) return null;
        const color = state.blocked
          ? "bg-red-100/80"
          : state.effective
            ? "bg-emerald-100/90"
            : "bg-amber-50";
        return (
          <div
            key={slot}
            className={`pointer-events-none absolute inset-x-0 z-0 border-b border-white/70 ${color}`}
            style={{ top: timeToOffset(slot, startHour), height: Math.max(18, slotDurationMinutes / 60 * hourHeight) }}
            title={state.label}
          />
        );
      })}
      {accessEventLayouts.map(({ event, range, lane, laneCount }) => {
        const start = Math.max(timeToMinutes(range.start), startHour * 60);
        const end = Math.min(timeToMinutes(range.end), endHour * 60);
        if (end <= start) return null;
        const scope = event.resourceIds.length === 0
          ? "Toda a equipe"
          : event.resourceIds.map((id) => resources.find((resource) => resource.id === id)?.name ?? id).join(", ");
        return (
          <div
            key={event._id}
            className={`pointer-events-none absolute z-[1] overflow-hidden border border-dashed ${event.type === "permission" ? "border-emerald-400 bg-emerald-50/40 text-emerald-800" : "border-burnt-coral/50 bg-burnt-coral/[0.1] text-burnt-coral"}`}
            style={{
              top: (start - startHour * 60) / 60 * hourHeight,
              height: (end - start) / 60 * hourHeight,
              left: `calc(${lane / laneCount * 100}% + 1px)`,
              width: `calc(${100 / laneCount}% - 2px)`,
            }}
            title={`${event.title} · ${scope}`}
          >
            <span className="block truncate bg-white/75 px-1 py-0.5 text-[8px] font-bold">{event.title}</span>
            <span className="block truncate px-1 text-[7px] font-medium opacity-80">{scope}</span>
          </div>
        );
      })}
      {appointments.map((appointment) => {
        const start = Math.max(timeToMinutes(formatTime(appointment.startAt, timezone)), startHour * 60);
        const end = Math.min(timeToMinutes(formatTime(appointment.endAt, timezone)), endHour * 60);
        const definition = eventTypes.find((eventType) => eventType.key === appointment.eventType);
        const color = definition?.color ?? "#475569";
        const editable = appointment.status === "scheduled" || appointment.status === "held";
        return (
          <article key={appointment._id} onClick={editable ? () => onEditEvent(appointment) : undefined} className={`group absolute inset-x-1 z-10 overflow-hidden rounded-md border bg-white px-2 py-1.5 shadow-sm ${editable ? "cursor-pointer hover:shadow-md" : ""} ${appointment.status === "cancelled" ? "opacity-50" : ""}`} style={{ top: (start - startHour * 60) / 60 * hourHeight + 1, height: Math.max(32, (end - start) / 60 * hourHeight - 2), borderLeft: `4px solid ${color}` }}>
            <div className="min-w-0 pr-12">
              <p className="truncate text-[10px] font-bold" style={{ color }}><Clock3 className="mr-1 inline h-3 w-3" />{formatTime(appointment.startAt, timezone)}–{formatTime(appointment.endAt, timezone)}</p>
              <p className="truncate text-xs font-semibold text-slate-ink">{appointment.customerName || appointment.customTitle || "Sem cliente"}</p>
              <p className="truncate text-[9px] text-stone">{appointment.customTitle || definition?.name || "Evento personalizado"}</p>
            </div>
            <div className="absolute right-1 top-1 flex rounded bg-white/95 shadow-sm">
              {conflictIds.has(appointment._id) && <span className="flex h-6 w-6 items-center justify-center text-amber-700" title="Conflito"><TriangleAlert className="h-3.5 w-3.5" /></span>}
              {editable && <button type="button" onClick={(event) => { event.stopPropagation(); onEditEvent(appointment); }} className="flex h-6 w-6 items-center justify-center text-stone hover:text-deep-teal" aria-label="Editar evento"><Pencil className="h-3.5 w-3.5" /></button>}
              <button type="button" onClick={(event) => { event.stopPropagation(); void onDeleteEvent(appointment); }} disabled={deletingId === appointment._id} className="flex h-6 w-6 items-center justify-center text-stone hover:text-burnt-coral disabled:opacity-40" aria-label="Excluir evento"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </article>
        );
      })}
    </div>
  );
});

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-ink"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-deep-teal" />{label}</label>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm border border-black/5 ${color}`} />{label}</span>;
}

function getTeamSlotState(input: {
  resources: ResourceDefinition[];
  accessEvents: CalendarAccessEvent[];
  dateKey: string;
  day: Date;
  timezone: string;
  start: string;
  end: string;
}) {
  const resourceStates = input.resources.map((resource) => {
    const availability = resource.weeklyAvailability.find((item) => item.weekday === getIsoWeekday(input.day));
    const configured = Boolean(availability?.enabled && availability.intervals.some((interval) => (
      interval.startTime <= input.start && interval.endTime >= input.end
    )));
    const applicableEvents = input.accessEvents.filter((event) => (
      event.resourceIds.length === 0 || event.resourceIds.includes(resource.id)
    ));
    const permitted = applicableEvents.some((event) => {
      const range = getAccessEventRangeForDay(event, input.dateKey, input.timezone);
      return event.type === "permission" && range && range.start <= input.start && range.end >= input.end;
    });
    const blocked = applicableEvents.some((event) => {
      const range = getAccessEventRangeForDay(event, input.dateKey, input.timezone);
      return event.type === "blocker" && range && rangesOverlap(input.start, input.end, range.start, range.end);
    });
    return { resource, configured, permitted, blocked };
  });
  const configured = resourceStates.length > 0 && resourceStates.every((state) => state.configured);
  const permitted = resourceStates.length > 0 && resourceStates.every((state) => state.permitted);
  const blocked = resourceStates.some((state) => state.blocked);
  const unavailableNames = resourceStates.filter((state) => !state.configured).map((state) => state.resource.name);
  const missingPermissionNames = resourceStates.filter((state) => !state.permitted).map((state) => state.resource.name);
  const blockedNames = resourceStates.filter((state) => state.blocked).map((state) => state.resource.name);
  const label = blocked
    ? `Bloqueado para ${blockedNames.join(", ")}`
    : !configured
      ? `Fora do expediente de ${unavailableNames.join(", ")}`
      : !permitted
        ? `Sem permissão aplicável para ${missingPermissionNames.join(", ")}`
        : "Disponível para todos os profissionais selecionados";
  return { configured, permitted, blocked, effective: configured && permitted && !blocked, label };
}

function getTimelineBounds(days: Date[], appointments: Appointment[], resources: ResourceDefinition[], selectedResourceId: string, timezone: string) {
  const times = resources
    .filter((resource) => !selectedResourceId || resource.id === selectedResourceId)
    .flatMap((resource) => resource.weeklyAvailability.flatMap((day) => day.intervals.flatMap((interval) => [interval.startTime, interval.endTime])))
    .concat(appointments.flatMap((appointment) => [formatTime(appointment.startAt, timezone), formatTime(appointment.endAt, timezone)]));
  if (times.length === 0 || days.length === 0) return { startHour: 8, endHour: 19 };
  const minutes = times.map(timeToMinutes);
  return {
    startHour: Math.max(0, Math.floor(Math.min(...minutes) / 60) - 1),
    endHour: Math.min(24, Math.ceil(Math.max(...minutes) / 60) + 1),
  };
}

function createTimeSlots(startHour: number, endHour: number, step: number) {
  const slots: string[] = [];
  for (let minutes = startHour * 60; minutes < endHour * 60; minutes += step) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return slots;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(endA) > timeToMinutes(startB);
}

function addMinutesToTime(time: string, minutes: number) {
  const total = timeToMinutes(time) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeToOffset(time: string, startHour: number) {
  return (timeToMinutes(time) - startHour * 60) / 60 * hourHeight;
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function getIsoWeekday(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}

function getCurrentWeekStart(timezone: string) {
  const today = getToday(timezone);
  return addDays(today, -((today.getDay() + 6) % 7));
}

function getTodayIndex(weekStart: Date, timezone: string) {
  const todayKey = toDateKey(getToday(timezone));
  const index = Array.from({ length: 7 }, (_, dayIndex) => toDateKey(addDays(weekStart, dayIndex))).indexOf(todayKey);
  return index >= 0 ? index : 0;
}

function getToday(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day));
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(value));
}

function formatWeekRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function accessEventTouchesDate(event: CalendarAccessEvent, dateKey: string, timezone: string) {
  return getDateKey(event.startAt, timezone) <= dateKey && getDateKey(event.endAt, timezone) >= dateKey;
}

function groupAppointmentsByDay(appointments: Appointment[], timezone: string) {
  const grouped = new Map<string, Appointment[]>();
  for (const appointment of appointments) {
    const dateKey = getDateKey(appointment.startAt, timezone);
    const day = grouped.get(dateKey);
    if (day) day.push(appointment);
    else grouped.set(dateKey, [appointment]);
  }
  return grouped;
}

function groupAccessEventsByDay(events: CalendarAccessEvent[], days: Date[], timezone: string) {
  const grouped = new Map<string, CalendarAccessEvent[]>();
  for (const day of days) {
    const dateKey = toDateKey(day);
    grouped.set(dateKey, events.filter((event) => accessEventTouchesDate(event, dateKey, timezone)));
  }
  return grouped;
}

function getAccessEventRangeForDay(event: CalendarAccessEvent, dateKey: string, timezone: string) {
  const startDate = getDateKey(event.startAt, timezone);
  const endDate = getDateKey(event.endAt, timezone);
  if (dateKey < startDate || dateKey > endDate) return null;
  return {
    start: dateKey === startDate ? formatTime(event.startAt, timezone) : "00:00",
    end: dateKey === endDate ? formatTime(event.endAt, timezone) : "24:00",
  };
}

function layoutAccessEvents(events: CalendarAccessEvent[], dateKey: string, timezone: string) {
  const ranged = events.flatMap((event) => {
    const range = getAccessEventRangeForDay(event, dateKey, timezone);
    return range ? [{ event, range }] : [];
  });
  return ranged.map((item) => {
    const overlapping = ranged
      .filter((candidate) => rangesOverlap(item.range.start, item.range.end, candidate.range.start, candidate.range.end))
      .sort((first, second) => (
        first.range.start.localeCompare(second.range.start)
        || first.event._id.localeCompare(second.event._id)
      ));
    return {
      ...item,
      lane: Math.max(0, overlapping.findIndex((candidate) => candidate.event._id === item.event._id)),
      laneCount: Math.max(1, overlapping.length),
    };
  });
}

function findConflictIds(appointments: Appointment[]) {
  const conflicts = new Set<string>();
  appointments.forEach((appointment, index) => {
    if (appointment.status === "cancelled") return;
    for (const other of appointments.slice(index + 1)) {
      if (other.status === "cancelled" || appointment.providerId !== other.providerId) continue;
      if (new Date(appointment.startAt) < new Date(other.endAt) && new Date(appointment.endAt) > new Date(other.startAt)) {
        conflicts.add(appointment._id);
        conflicts.add(other._id);
      }
    }
  });
  return conflicts;
}

function matchesAppointmentStatus(appointment: Appointment, status: string) {
  if (!status) return true;
  if (status === "pending") {
    return appointment.status === "scheduled"
      && (appointment.confirmationStatus === "pending" || (!appointment.confirmationStatus && appointment.source === "manual"));
  }
  if (status === "confirmed") {
    return appointment.status === "scheduled"
      && !(appointment.confirmationStatus === "pending" || (!appointment.confirmationStatus && appointment.source === "manual"));
  }
  return appointment.status === status;
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
}

export default memo(WeekCalendar);
