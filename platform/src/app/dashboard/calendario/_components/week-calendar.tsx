"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

interface Appointment {
  _id: string;
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

const dayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

export default function WeekCalendar({
  timezone,
  eventTypes,
  refreshKey,
  onCreateEvent,
}: {
  timezone: string;
  eventTypes: EventTypeDefinition[];
  refreshKey: number;
  onCreateEvent: (date: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart(timezone));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showAppointments, setShowAppointments] = useState(true);
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
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar a semana.");
        if (!active) return;
        setError("");
        setAppointments(data.appointments ?? []);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Falha ao carregar a semana.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [weekStart, refreshKey]);

  function navigateTo(nextWeekStart: Date) {
    setLoading(true);
    setWeekStart(nextWeekStart);
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-deep-teal">Visão semanal</p>
          <h2 id="week-calendar-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">
            {formatWeekRange(days[0], days[6])}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle label="Eventos" checked={showAppointments} onChange={setShowAppointments} color="teal" />
          <div className="ml-1 flex overflow-hidden rounded-md border border-mist bg-white">
            <button type="button" onClick={() => navigateTo(addDays(weekStart, -7))} className="flex h-9 w-9 items-center justify-center border-r border-mist text-slate-ink hover:bg-soft-ivory" aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => navigateTo(getCurrentWeekStart(timezone))} className="px-3 text-xs font-semibold text-slate-ink hover:bg-soft-ivory">Hoje</button>
            <button type="button" onClick={() => navigateTo(addDays(weekStart, 7))} className="flex h-9 w-9 items-center justify-center border-l border-mist text-slate-ink hover:bg-soft-ivory" aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-burnt-coral">{error}</p>}
      <div className="mt-4 overflow-hidden rounded-lg border border-mist bg-white lg:overflow-x-auto">
        <div className="grid grid-cols-1 divide-y divide-mist lg:min-w-[980px] lg:grid-cols-7 lg:divide-x lg:divide-y-0">
          {days.map((day) => {
            const dateKey = toDateKey(day);
            const dayAppointments = appointments.filter((item) => getDateKey(item.startAt, timezone) === dateKey);
            const appointmentGroups = groupOverlappingAppointments(dayAppointments);
            const isToday = dateKey === toDateKey(getToday(timezone));
            return (
              <div key={dateKey} className="bg-white lg:min-h-[390px]">
                <div className={`flex items-center gap-2 border-b border-mist px-3 py-3 lg:block ${isToday ? "bg-deep-teal/5" : "bg-soft-ivory"}`}>
                  <p className="text-xs font-semibold uppercase text-stone">{dayFormatter.format(day).replace(".", "")}</p>
                  <p className={`text-lg font-bold lg:mt-1 ${isToday ? "text-deep-teal" : "text-slate-ink"}`}>{day.getDate()}</p>
                </div>
                <div className="space-y-2 p-2">
                  {loading && <p className="py-8 text-center text-xs text-stone">Carregando…</p>}
                  {!loading && showAppointments && appointmentGroups.map((lanes) => (
                    <div key={lanes[0][0]._id} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}>
                      {lanes.map((lane) => (
                        <div key={lane[0]._id} className="min-w-0 space-y-2">
                          {lane.map((appointment) => {
                            const definition = eventTypes.find((eventType) => eventType.key === appointment.eventType) ?? eventTypes[0];
                            const color = definition?.color ?? "#0F766E";
                            return (
                              <article key={appointment._id} className="min-w-0 border-l-2 px-2 py-2" style={{ borderColor: color, backgroundColor: `${color}12` }}>
                                <div className="flex items-start justify-between gap-1">
                                  <p className="min-w-0 break-words text-xs font-bold" style={{ color }}>{formatTime(appointment.startAt, timezone)}–{formatTime(appointment.endAt, timezone)}</p>
                                  <button type="button" onClick={() => deleteEvent(appointment)} disabled={deletingId === appointment._id} className="flex h-6 w-6 shrink-0 items-center justify-center text-stone hover:bg-burnt-coral/10 hover:text-burnt-coral disabled:opacity-40" aria-label={`Excluir evento de ${appointment.customerName || "sem cliente"}`} title="Excluir evento">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <p className="mt-1 break-words text-xs font-semibold text-slate-ink">{appointment.customerName || "Sem cliente"}</p>
                                <p className="mt-0.5 break-words text-[10px] text-stone">{definition?.name ?? "Tipo removido"} · {formatAppointmentStatus(appointment.status)}</p>
                              </article>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ))}
                  {!loading && (!showAppointments || dayAppointments.length === 0) && (
                    <p className="py-4 text-center text-xs text-stone lg:py-8">Sem eventos</p>
                  )}
                  {!loading && (
                    <button type="button" onClick={() => onCreateEvent(dateKey)} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 border border-dashed border-mist px-2 text-xs font-semibold text-deep-teal hover:border-deep-teal/40 hover:bg-deep-teal/5">
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

function Toggle({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: (checked: boolean) => void; color: "teal" }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs font-semibold text-slate-ink">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? color === "teal" ? "bg-deep-teal" : "bg-burnt-coral" : "bg-mist"}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
      {label}
    </label>
  );
}

function getCurrentWeekStart(timezone: string) {
  const today = getToday(timezone);
  return addDays(today, -today.getDay());
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

function formatAppointmentStatus(status: Appointment["status"]) {
  if (status === "scheduled") return "Agendado";
  if (status === "cancelled") return "Cancelado";
  return "Concluído";
}

function groupOverlappingAppointments(appointments: Appointment[]) {
  const sorted = [...appointments].sort((first, second) => (
    new Date(first.startAt).getTime() - new Date(second.startAt).getTime()
  ));
  const groups: Appointment[][][] = [];
  let cluster: Appointment[] = [];
  let clusterEnd = 0;

  function appendCluster() {
    if (cluster.length === 0) return;
    const lanes: Appointment[][] = [];
    for (const appointment of cluster) {
      const start = new Date(appointment.startAt).getTime();
      const lane = lanes.find((items) => new Date(items[items.length - 1].endAt).getTime() <= start);
      if (lane) lane.push(appointment);
      else lanes.push([appointment]);
    }
    groups.push(lanes);
  }

  for (const appointment of sorted) {
    const start = new Date(appointment.startAt).getTime();
    const end = new Date(appointment.endAt).getTime();
    if (cluster.length > 0 && start >= clusterEnd) {
      appendCluster();
      cluster = [];
      clusterEnd = 0;
    }
    cluster.push(appointment);
    clusterEnd = Math.max(clusterEnd, end);
  }
  appendCluster();
  return groups;
}
