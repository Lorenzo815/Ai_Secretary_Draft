"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import WeekCalendar from "./_components/week-calendar";

interface DayAvailability {
  weekday: number;
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

interface EventTypeDefinition {
  key: string;
  name: string;
  color: string;
  durationMinutes: number;
  resourceId: string;
}

interface ResourceDefinition {
  id: string;
  name: string;
  weeklyAvailability: DayAvailability[];
}

interface Settings {
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  weeklyAvailability: DayAvailability[];
  resources: ResourceDefinition[];
  eventTypes: EventTypeDefinition[];
}

interface Appointment {
  _id: string;
  customerName: string;
  startAt: string;
  endAt: string;
  status: "scheduled" | "cancelled" | "completed";
  eventType?: CalendarEventType;
  notes?: string;
}

interface CustomerOption { id: string; name: string; phone: string }
type CalendarEventType = string;

const dayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export default function CalendarPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("consultation");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [activeResourceId, setActiveResourceId] = useState("doctor");
  const backgroundRefreshInFlight = useRef(false);
  const interactionBlocked = useRef(false);
  interactionBlocked.current = busy || settingsOpen || eventOpen;

  async function refreshCalendar(successMessage?: string) {
    setBusy(true);
    try {
      const data = await requestCalendarData();
      setSettings(data.settings);
      setAppointments(data.appointments ?? []);
      setCustomers(data.customers ?? []);
      setCustomerId((current) => current || data.customers?.[0]?.id || "");
      setEventType((current) => data.settings.eventTypes.some((item) => item.key === current) ? current : data.settings.eventTypes[0]?.key ?? "");
      setFeedback(successMessage ?? "Agenda atualizada.");
      setCalendarRefreshKey((current) => current + 1);
    } catch (refreshError) {
      setFeedback(refreshError instanceof Error ? refreshError.message : "Não foi possível atualizar a agenda.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    void requestCalendarData()
      .then((data) => {
        if (!active) return;
        setSettings(data.settings);
        setAppointments(data.appointments ?? []);
        setCustomers(data.customers ?? []);
        setCustomerId(data.customers?.[0]?.id ?? "");
        setEventType(data.settings.eventTypes[0]?.key ?? "");
      })
      .catch((loadError) => {
        if (!active) return;
        setFeedback(loadError instanceof Error ? loadError.message : "Não foi possível carregar a agenda.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshInBackground() {
      if (
        document.visibilityState !== "visible"
        || interactionBlocked.current
        || backgroundRefreshInFlight.current
      ) return;

      backgroundRefreshInFlight.current = true;
      try {
        const data = await requestCalendarData();
        if (!active || document.visibilityState !== "visible" || interactionBlocked.current) return;
        setSettings(data.settings);
        setAppointments(data.appointments ?? []);
        setCustomers(data.customers ?? []);
        setCustomerId((current) => current || data.customers?.[0]?.id || "");
        setEventType((current) => data.settings.eventTypes.some((item) => item.key === current) ? current : data.settings.eventTypes[0]?.key ?? "");
        setCalendarRefreshKey((current) => current + 1);
      } catch {
        // A later poll retries without replacing useful user feedback.
      } finally {
        backgroundRefreshInFlight.current = false;
      }
    }

    const interval = window.setInterval(refreshInBackground, 10_000);
    document.addEventListener("visibilitychange", refreshInBackground);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, []);

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setFeedback("");
    const response = await fetch("/api/calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = await response.json() as { settings?: Settings; error?: string };
    if (response.ok && data.settings) {
      setSettings(data.settings);
      setFeedback("Expediente e regras atualizados.");
      setSettingsOpen(false);
    } else {
      setFeedback(data.error ?? "Não foi possível salvar.");
    }
    setBusy(false);
  }

  function openCreateEvent(targetDate?: string) {
    const nextDate = targetDate ?? date;
    setDate(nextDate);
    setTime("");
    setFeedback("");
    setEventOpen(true);
  }

  async function createAppointment() {
    if (!eventType || !date || !time) return;
    setBusy(true);
    const response = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, startAt: `${date}T${time}`, eventType, notes }),
    });
    const data = await response.json() as { appointment?: Appointment; error?: string };
    if (response.ok && data.appointment) {
      setTime("");
      setNotes("");
      setEventOpen(false);
      await refreshCalendar(`${settings ? getEventTypeName(settings, eventType) : "Evento"} criado com sucesso.`);
    } else {
      setFeedback(data.error ?? "Não foi possível agendar.");
    }
    setBusy(false);
  }

  async function cancel(id: string) {
    setBusy(true);
    const response = await fetch(`/api/calendar/appointments/${id}`, { method: "DELETE" });
    const data = await response.json() as { error?: string };
    if (response.ok) {
      await refreshCalendar("Evento cancelado.");
    } else {
      setFeedback(data.error ?? "Não foi possível cancelar.");
    }
    setBusy(false);
  }

  function updateDay(weekday: number, patch: Partial<DayAvailability>) {
    if (!settings) return;
    setSettings({
      ...settings,
      resources: settings.resources.map((resource) => resource.id === activeResourceId ? {
        ...resource,
        weeklyAvailability: resource.weeklyAvailability.map((day) => day.weekday === weekday ? {
          ...day,
          ...patch,
          intervals: patch.enabled && day.intervals.length === 0
            ? [{ startTime: "09:00", endTime: "17:00" }]
            : day.intervals,
        } : day),
      } : resource),
    });
  }

  function updateInterval(weekday: number, index: number, patch: Partial<DayAvailability["intervals"][number]>) {
    setSettings((current) => current ? {
      ...current,
      resources: current.resources.map((resource) => resource.id === activeResourceId ? {
        ...resource,
        weeklyAvailability: resource.weeklyAvailability.map((day) => day.weekday === weekday ? {
          ...day,
          intervals: day.intervals.map((interval, intervalIndex) => intervalIndex === index ? { ...interval, ...patch } : interval),
        } : day),
      } : resource),
    } : current);
  }

  function addInterval(weekday: number) {
    setSettings((current) => current ? {
      ...current,
      resources: current.resources.map((resource) => resource.id === activeResourceId ? {
        ...resource,
        weeklyAvailability: resource.weeklyAvailability.map((day) => day.weekday === weekday ? {
          ...day,
          enabled: true,
          intervals: [...day.intervals, { startTime: "13:00", endTime: "17:00" }],
        } : day),
      } : resource),
    } : current);
  }

  function removeInterval(weekday: number, index: number) {
    setSettings((current) => current ? {
      ...current,
      resources: current.resources.map((resource) => resource.id === activeResourceId ? {
        ...resource,
        weeklyAvailability: resource.weeklyAvailability.map((day) => day.weekday === weekday ? {
          ...day,
          intervals: day.intervals.filter((_, intervalIndex) => intervalIndex !== index),
        } : day),
      } : resource),
    } : current);
  }

  function updateResourceName(name: string) {
    setSettings((current) => current ? {
      ...current,
      resources: current.resources.map((resource) => resource.id === activeResourceId ? { ...resource, name } : resource),
    } : current);
  }

  function updateEventType(key: string, patch: Partial<EventTypeDefinition>) {
    setSettings((current) => current ? {
      ...current,
      eventTypes: current.eventTypes.map((eventType) => eventType.key === key ? { ...eventType, ...patch } : eventType),
    } : current);
  }

  function addEventType() {
    const key = `event_${Date.now()}`;
    setSettings((current) => current ? {
      ...current,
      eventTypes: [...current.eventTypes, { key, name: "Novo tipo", color: "#0F766E", durationMinutes: current.slotDurationMinutes, resourceId: "doctor" }],
    } : current);
  }

  function removeEventType(key: string) {
    setSettings((current) => current && current.eventTypes.length > 1 ? {
      ...current,
      eventTypes: current.eventTypes.filter((eventType) => eventType.key !== key),
    } : current);
    setEventType((current) => current === key ? "" : current);
  }

  if (!settings) {
    return <p className="py-20 text-center text-sm text-stone">{feedback || "Carregando agenda..."}</p>;
  }

  return (
    <div className="animate-fade-in-up space-y-8">
      <header className="border-b border-mist pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-deep-teal">Operação</p>
            <h1 className="mt-2 font-heading text-2xl font-bold text-slate-ink">Calendário clínico</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone">O expediente abaixo é a fonte de verdade usada pela equipe e pela IA para oferecer e reservar horários.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => refreshCalendar()} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-mist bg-white px-3 text-sm font-semibold text-slate-ink hover:border-deep-teal/40 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />Atualizar</button>
            <button type="button" onClick={() => openCreateEvent()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-deep-teal px-3 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5"><CalendarPlus className="h-4 w-4" />Novo evento</button>
            <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-deep-teal px-3 text-sm font-semibold text-white hover:bg-forest-teal"><Settings2 className="h-4 w-4" />Configurar agenda</button>
          </div>
        </div>
      </header>

      <WeekCalendar timezone={settings.timezone} eventTypes={settings.eventTypes} refreshKey={calendarRefreshKey} onCreateEvent={openCreateEvent} />

      {eventOpen && createPortal(<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-ink/45 p-4 py-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="event-title" className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="event-title" className="font-heading text-lg font-semibold text-slate-ink">Novo evento</h2>
              <p className="mt-1 text-xs text-stone">Escolha qualquer data e hora para incluir o evento manualmente.</p>
            </div>
            <button type="button" onClick={() => setEventOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-soft-ivory hover:text-slate-ink" aria-label="Fechar novo evento"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-ink">Tipo de evento
              <select value={eventType} onChange={(event) => setEventType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                {settings.eventTypes.map((item) => <option key={item.key} value={item.key}>{item.name} · {item.durationMinutes} min</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-ink">Cliente
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                <option value="">Sem cliente</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · +{customer.phone}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-ink">Data
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
            </label>
            <label className="text-xs font-semibold text-slate-ink">Hora
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
            </label>
          </div>

          <label className="mt-5 block text-xs font-semibold text-slate-ink">Observação
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação administrativa opcional" className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setEventOpen(false)} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Cancelar</button>
            <button type="button" onClick={createAppointment} disabled={busy || !eventType || !date || !time} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-40">Criar evento</button>
          </div>
        </section>
      </div>, document.body)}

      {settingsOpen && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-ink/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="hours-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="shrink-0 border-b border-mist px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="hours-title" className="font-heading text-lg font-semibold text-slate-ink">Configuração da agenda</h2>
              <p className="mt-1 text-xs text-stone">Defina regras gerais e intervalos diferentes para cada dia da semana.</p>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-soft-ivory hover:text-slate-ink" aria-label="Fechar configuração"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-ink sm:col-span-2">
            Profissional
            <input value={settings.providerName} onChange={(event) => setSettings({ ...settings, providerName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Intervalo da grade
            <select value={settings.slotDurationMinutes} onChange={(event) => setSettings({ ...settings, slotDurationMinutes: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
              {[15, 20, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
            </select>
            <span className="mt-2 block font-normal leading-5 text-stone">Define a distância entre horários de início. Com 30 min: 09:00, 09:30 e 10:00. Não altera a duração do evento.</span>
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Antecedência mínima (h)
            <input type="number" min="0" max="720" value={settings.minimumNoticeHours} onChange={(event) => setSettings({ ...settings, minimumNoticeHours: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
            <span className="mt-2 block font-normal leading-5 text-stone">Evita agendamentos muito próximos. Com 24 h, só são oferecidos horários a partir de 24 horas do momento atual.</span>
          </label>
        </div>
        <p className="text-xs leading-5 text-stone">Todos os horários seguem o fuso {settings.timezone}.</p>

        <section aria-labelledby="event-types-title" className="border-y border-mist py-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 id="event-types-title" className="text-sm font-semibold text-slate-ink">Tipos de evento</h3>
              <p className="mt-1 text-xs text-stone">Personalize nome, cor, duração e agenda responsável por cada tipo.</p>
            </div>
            <button type="button" onClick={addEventType} disabled={settings.eventTypes.length >= 20} className="rounded-lg border border-deep-teal/30 px-3 py-2 text-xs font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:opacity-40">Adicionar tipo</button>
          </div>
          <div className="mt-4 divide-y divide-mist border-y border-mist">
            {settings.eventTypes.map((eventType) => (
              <div key={eventType.key} className="grid gap-3 py-4 sm:grid-cols-[64px_minmax(150px,1fr)_130px_110px_40px] sm:items-end">
                <label className="text-xs font-semibold text-slate-ink">Cor
                  <input type="color" value={eventType.color} onChange={(event) => updateEventType(eventType.key, { color: event.target.value })} className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-mist bg-white p-1" aria-label={`Cor de ${eventType.name}`} />
                </label>
                <label className="text-xs font-semibold text-slate-ink">Nome
                  <input value={eventType.name} maxLength={60} onChange={(event) => updateEventType(eventType.key, { name: event.target.value })} className="mt-1 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal outline-none focus:border-deep-teal" />
                </label>
                <label className="text-xs font-semibold text-slate-ink">Duração
                  <select value={eventType.durationMinutes} onChange={(event) => updateEventType(eventType.key, { durationMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal">
                    {[15, 20, 30, 45, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-ink">Recurso
                  <select value={eventType.resourceId} onChange={(event) => updateEventType(eventType.key, { resourceId: event.target.value })} className="mt-1 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal">
                    {settings.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => removeEventType(eventType.key)} disabled={settings.eventTypes.length === 1} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-30" aria-label={`Remover ${eventType.name}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </section>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-ink">Agenda do recurso
            <select value={activeResourceId} onChange={(event) => setActiveResourceId(event.target.value)} className="mt-1.5 block min-h-10 rounded-md border border-mist bg-white px-3 text-sm font-normal">
              {settings.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </label>
          <label className="min-w-64 flex-1 text-xs font-semibold text-slate-ink">Nome exibido
            <input value={settings.resources.find((resource) => resource.id === activeResourceId)?.name ?? ""} onChange={(event) => updateResourceName(event.target.value)} className="mt-1.5 block min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
        </div>
        <div className="overflow-x-auto rounded-lg border border-mist bg-white">
          <table className="w-full min-w-[780px] text-left">
            <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone">
              <tr><th className="px-4 py-3">Dia</th><th className="px-4 py-3">Atende</th><th className="px-4 py-3">Intervalos</th><th className="px-4 py-3 text-right">Adicionar</th></tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {(settings.resources.find((resource) => resource.id === activeResourceId)?.weeklyAvailability ?? []).map((day) => (
                <tr key={day.weekday}>
                  <td className="px-4 py-3 text-sm font-semibold text-slate-ink">{dayNames[day.weekday - 1]}</td>
                  <td className="px-4 py-3"><input type="checkbox" checked={day.enabled} onChange={(event) => updateDay(day.weekday, { enabled: event.target.checked })} className="h-4 w-4 accent-deep-teal" /></td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      {day.intervals.map((interval, index) => (
                        <div key={`${day.weekday}-${index}`} className="flex items-center gap-2">
                          <input type="time" disabled={!day.enabled} value={interval.startTime} onChange={(event) => updateInterval(day.weekday, index, { startTime: event.target.value })} className="rounded-lg border border-mist px-3 py-2 text-sm disabled:bg-soft-ivory" aria-label={`Início do intervalo ${index + 1} de ${dayNames[day.weekday - 1]}`} />
                          <span className="text-xs text-stone">até</span>
                          <input type="time" disabled={!day.enabled} value={interval.endTime} onChange={(event) => updateInterval(day.weekday, index, { endTime: event.target.value })} className="rounded-lg border border-mist px-3 py-2 text-sm disabled:bg-soft-ivory" aria-label={`Fim do intervalo ${index + 1} de ${dayNames[day.weekday - 1]}`} />
                          <button type="button" onClick={() => removeInterval(day.weekday, index)} disabled={!day.enabled} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-30" aria-label={`Remover intervalo ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ))}
                      {day.enabled && day.intervals.length === 0 && <p className="text-xs text-burnt-coral">Adicione ao menos um intervalo.</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => addInterval(day.weekday)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-mist text-deep-teal hover:border-deep-teal/40" aria-label={`Adicionar intervalo em ${dayNames[day.weekday - 1]}`}><Plus className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-mist bg-white px-5 py-4 sm:px-7">
          <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Fechar</button>
          <button type="button" onClick={saveSettings} disabled={busy} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50">Salvar expediente</button>
        </div>
      </section>
      </div>, document.body)}

      <section aria-labelledby="upcoming-title" className="border-t border-mist pt-7">
        <h2 id="upcoming-title" className="font-heading text-lg font-semibold text-slate-ink">Próximos atendimentos</h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-mist bg-white">
          {appointments.length === 0 ? <p className="px-5 py-12 text-center text-sm text-stone">Nenhum atendimento nos próximos 60 dias.</p> : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Observação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
              <tbody className="divide-y divide-mist">{appointments.map((appointment) => (
                <tr key={appointment._id}><td className="px-4 py-3 font-semibold text-slate-ink">{formatDateTime(appointment.startAt, settings.timezone)}</td><td className="px-4 py-3 text-slate-ink">{appointment.customerName || "Sem cliente"}</td><td className="px-4 py-3 text-stone">{getEventTypeName(settings, appointment.eventType)}</td><td className="px-4 py-3 text-stone">{appointment.status === "scheduled" ? "Agendado" : appointment.status === "cancelled" ? "Cancelado" : "Concluído"}</td><td className="px-4 py-3 text-stone">{appointment.notes || "—"}</td><td className="px-4 py-3 text-right">{appointment.status === "scheduled" && <button type="button" onClick={() => cancel(appointment._id)} disabled={busy} className="font-semibold text-burnt-coral hover:underline">Cancelar</button>}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>

      <p className={`text-sm ${feedback.includes("não") || feedback.includes("Falha") ? "text-burnt-coral" : "text-deep-teal"}`} aria-live="polite">{feedback}</p>
    </div>
  );
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

async function requestCalendarData() {
  const response = await fetch("/api/calendar", { cache: "no-store" });
  const data = await response.json() as {
    settings?: Settings;
    appointments?: Appointment[];
    customers?: CustomerOption[];
    error?: string;
  };
  if (!response.ok || !data.settings) {
    throw new Error(data.error ?? "Não foi possível carregar a agenda.");
  }
  return {
    settings: data.settings,
    appointments: data.appointments,
    customers: data.customers,
  };
}

function getEventTypeName(settings: Settings, key?: string) {
  return settings.eventTypes.find((eventType) => eventType.key === key)?.name ?? "Tipo removido";
}