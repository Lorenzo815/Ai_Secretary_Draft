"use client";

import { useEffect, useState } from "react";

interface Appointment {
  _id: string;
  customerName: string;
  startAt: string;
  endAt: string;
  status: "scheduled" | "cancelled" | "completed";
}

interface ScheduledTrigger {
  _id: string;
  appointmentId: string;
  customerId: string;
  type: "appointment_reminder";
  dueAt: string;
  status: "pending" | "processing" | "awaiting_response" | "completed" | "cancelled" | "failed";
}

interface CustomerOption {
  id: string;
  name: string;
}

const dayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

export default function WeekCalendar({
  timezone,
  customers,
  refreshKey,
}: {
  timezone: string;
  customers: CustomerOption[];
  refreshKey: number;
}) {
  const [weekStart, setWeekStart] = useState(() => getCurrentWeekStart(timezone));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [triggers, setTriggers] = useState<ScheduledTrigger[]>([]);
  const [showAppointments, setShowAppointments] = useState(true);
  const [showTriggers, setShowTriggers] = useState(true);
  const [loading, setLoading] = useState(true);
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
          triggers?: ScheduledTrigger[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar a semana.");
        if (!active) return;
        setError("");
        setAppointments(data.appointments ?? []);
        setTriggers(data.triggers ?? []);
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
          <Toggle label="Pacientes" checked={showAppointments} onChange={setShowAppointments} color="teal" />
          <Toggle label="Automações" checked={showTriggers} onChange={setShowTriggers} color="coral" />
          <div className="ml-1 flex overflow-hidden rounded-lg border border-mist bg-white">
            <button type="button" onClick={() => navigateTo(addDays(weekStart, -7))} className="h-9 w-9 border-r border-mist text-lg text-slate-ink hover:bg-soft-ivory" aria-label="Semana anterior">‹</button>
            <button type="button" onClick={() => navigateTo(getCurrentWeekStart(timezone))} className="px-3 text-xs font-semibold text-slate-ink hover:bg-soft-ivory">Hoje</button>
            <button type="button" onClick={() => navigateTo(addDays(weekStart, 7))} className="h-9 w-9 border-l border-mist text-lg text-slate-ink hover:bg-soft-ivory" aria-label="Próxima semana">›</button>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-burnt-coral">{error}</p>}
      <div className="mt-4 overflow-hidden rounded-lg border border-mist bg-white lg:overflow-x-auto">
        <div className="grid grid-cols-1 divide-y divide-mist lg:min-w-[980px] lg:grid-cols-7 lg:divide-x lg:divide-y-0">
          {days.map((day) => {
            const dateKey = toDateKey(day);
            const dayAppointments = appointments.filter((item) => getDateKey(item.startAt, timezone) === dateKey);
            const dayTriggers = triggers.filter((item) => getDateKey(item.dueAt, timezone) === dateKey);
            const isToday = dateKey === toDateKey(getToday(timezone));
            return (
              <div key={dateKey} className="bg-white lg:min-h-[390px]">
                <div className={`flex items-center gap-2 border-b border-mist px-3 py-3 lg:block ${isToday ? "bg-deep-teal/5" : "bg-soft-ivory"}`}>
                  <p className="text-xs font-semibold uppercase text-stone">{dayFormatter.format(day).replace(".", "")}</p>
                  <p className={`text-lg font-bold lg:mt-1 ${isToday ? "text-deep-teal" : "text-slate-ink"}`}>{day.getDate()}</p>
                </div>
                <div className="space-y-2 p-2">
                  {loading && <p className="py-8 text-center text-xs text-stone">Carregando…</p>}
                  {!loading && showAppointments && dayAppointments.map((appointment) => (
                    <article key={appointment._id} className="border-l-2 border-deep-teal bg-deep-teal/5 px-2.5 py-2">
                      <p className="text-xs font-bold text-deep-teal">{formatTime(appointment.startAt, timezone)}–{formatTime(appointment.endAt, timezone)}</p>
                      <p className="mt-1 break-words text-xs font-semibold text-slate-ink">{appointment.customerName}</p>
                      <p className="mt-0.5 text-[10px] text-stone">{formatAppointmentStatus(appointment.status)}</p>
                    </article>
                  ))}
                  {!loading && showTriggers && dayTriggers.map((trigger) => (
                    <article key={trigger._id} className="border-l-2 border-burnt-coral bg-burnt-coral/5 px-2.5 py-2">
                      <p className="text-xs font-bold text-burnt-coral">{formatTime(trigger.dueAt, timezone)}</p>
                      <p className="mt-1 break-words text-xs font-semibold text-slate-ink">{customers.find((item) => item.id === trigger.customerId)?.name ?? "Cliente"}</p>
                      <p className="mt-0.5 text-[10px] text-stone">Lembrete · {formatTriggerStatus(trigger.status)}</p>
                    </article>
                  ))}
                  {!loading && (!showAppointments || dayAppointments.length === 0) && (!showTriggers || dayTriggers.length === 0) && (
                    <p className="py-4 text-center text-xs text-stone lg:py-8">Sem eventos</p>
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

function Toggle({ label, checked, onChange, color }: { label: string; checked: boolean; onChange: (checked: boolean) => void; color: "teal" | "coral" }) {
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

function formatTriggerStatus(status: ScheduledTrigger["status"]) {
  if (status === "pending") return "Pendente";
  if (status === "processing") return "Processando";
  if (status === "awaiting_response") return "Aguardando confirmação";
  if (status === "completed") return "Concluído";
  if (status === "cancelled") return "Cancelado";
  return "Falhou";
}
