"use client";

import { useEffect, useState } from "react";
import WeekCalendar from "./_components/week-calendar";

interface DayAvailability {
  weekday: number;
  enabled: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
}

interface Settings {
  providerName: string;
  timezone: string;
  slotDurationMinutes: number;
  minimumNoticeHours: number;
  followUpHoursBefore: number;
  weeklyAvailability: DayAvailability[];
}

interface Appointment {
  _id: string;
  customerName: string;
  startAt: string;
  endAt: string;
  status: "scheduled" | "cancelled" | "completed";
  notes?: string;
}

interface ScheduledTrigger {
  _id: string;
  appointmentId: string;
  customerId: string;
  type: "appointment_reminder";
  dueAt: string;
  status: "pending" | "processing" | "awaiting_response" | "completed" | "cancelled" | "failed";
  attempts: number;
}

interface CustomerOption { id: string; name: string; phone: string }
interface Slot { startAt: string; endAt: string; label: string }

const dayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const triggerStatusLabels: Record<ScheduledTrigger["status"], string> = {
  pending: "Pendente",
  processing: "Processando",
  awaiting_response: "Aguardando confirmação",
  completed: "Concluído",
  cancelled: "Cancelado",
  failed: "Falhou",
};

export default function CalendarPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [triggers, setTriggers] = useState<ScheduledTrigger[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function refreshCalendar(successMessage?: string) {
    setBusy(true);
    try {
      const data = await requestCalendarData();
      setSettings(data.settings);
      setAppointments(data.appointments ?? []);
      setTriggers(data.triggers ?? []);
      setCustomers(data.customers ?? []);
      setCustomerId((current) => current || data.customers?.[0]?.id || "");
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
        setTriggers(data.triggers ?? []);
        setCustomers(data.customers ?? []);
        setCustomerId(data.customers?.[0]?.id ?? "");
      })
      .catch((loadError) => {
        if (!active) return;
        setFeedback(loadError instanceof Error ? loadError.message : "Não foi possível carregar a agenda.");
      });
    return () => { active = false; };
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
      setSlots([]);
      setSettingsOpen(false);
    } else {
      setFeedback(data.error ?? "Não foi possível salvar.");
    }
    setBusy(false);
  }

  async function searchSlots() {
    if (!date) return;
    setBusy(true);
    setSelectedSlot("");
    const response = await fetch(`/api/calendar?mode=slots&fromDate=${date}&toDate=${date}`);
    const data = await response.json() as { slots?: Slot[]; error?: string };
    setSlots(data.slots ?? []);
    setFeedback(response.ok ? "" : data.error ?? "Falha ao consultar horários.");
    setBusy(false);
  }

  async function createAppointment() {
    if (!customerId || !selectedSlot) return;
    setBusy(true);
    const response = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, startAt: selectedSlot, notes }),
    });
    const data = await response.json() as { appointment?: Appointment; error?: string };
    if (response.ok && data.appointment) {
      setSlots((current) => current.filter((slot) => slot.startAt !== selectedSlot));
      setSelectedSlot("");
      setNotes("");
      await refreshCalendar("Atendimento agendado e follow-up programado.");
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
      await refreshCalendar("Consulta e follow-up cancelados.");
    } else {
      setFeedback(data.error ?? "Não foi possível cancelar.");
    }
    setBusy(false);
  }

  function updateDay(weekday: number, patch: Partial<DayAvailability>) {
    if (!settings) return;
    setSettings({
      ...settings,
      weeklyAvailability: settings.weeklyAvailability.map((day) =>
        day.weekday === weekday ? {
          ...day,
          ...patch,
          intervals: patch.enabled && day.intervals.length === 0
            ? [{ startTime: "09:00", endTime: "17:00" }]
            : day.intervals,
        } : day,
      ),
    });
  }

  function updateInterval(weekday: number, index: number, patch: Partial<DayAvailability["intervals"][number]>) {
    setSettings((current) => current ? {
      ...current,
      weeklyAvailability: current.weeklyAvailability.map((day) => day.weekday === weekday ? {
        ...day,
        intervals: day.intervals.map((interval, intervalIndex) => intervalIndex === index ? { ...interval, ...patch } : interval),
      } : day),
    } : current);
  }

  function addInterval(weekday: number) {
    setSettings((current) => current ? {
      ...current,
      weeklyAvailability: current.weeklyAvailability.map((day) => day.weekday === weekday ? {
        ...day,
        enabled: true,
        intervals: [...day.intervals, { startTime: "13:00", endTime: "17:00" }],
      } : day),
    } : current);
  }

  function removeInterval(weekday: number, index: number) {
    setSettings((current) => current ? {
      ...current,
      weeklyAvailability: current.weeklyAvailability.map((day) => day.weekday === weekday ? {
        ...day,
        intervals: day.intervals.filter((_, intervalIndex) => intervalIndex !== index),
      } : day),
    } : current);
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
          <div className="flex gap-2">
            <button type="button" onClick={() => refreshCalendar()} disabled={busy} className="rounded-lg border border-mist bg-white px-3 py-2 text-sm font-semibold text-slate-ink hover:border-deep-teal/40 disabled:opacity-50">Atualizar</button>
            <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-lg bg-deep-teal px-3 py-2 text-sm font-semibold text-white hover:bg-forest-teal">Configurar agenda</button>
          </div>
        </div>
      </header>

      <WeekCalendar timezone={settings.timezone} customers={customers} refreshKey={calendarRefreshKey} />

      {settingsOpen && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-ink/45 p-4 py-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="hours-title" className="w-full max-w-5xl space-y-5 rounded-lg bg-white p-5 shadow-xl sm:p-7">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="hours-title" className="font-heading text-lg font-semibold text-slate-ink">Configuração da agenda</h2>
              <p className="mt-1 text-xs text-stone">Defina regras gerais e intervalos diferentes para cada dia da semana.</p>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-stone hover:bg-soft-ivory hover:text-slate-ink" aria-label="Fechar configuração">×</button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-semibold text-slate-ink sm:col-span-2">
            Profissional
            <input value={settings.providerName} onChange={(event) => setSettings({ ...settings, providerName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Duração
            <select value={settings.slotDurationMinutes} onChange={(event) => setSettings({ ...settings, slotDurationMinutes: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
              {[15, 20, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Antecedência mínima
            <input type="number" min="0" max="720" value={settings.minimumNoticeHours} onChange={(event) => setSettings({ ...settings, minimumNoticeHours: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-ink">
            Lembrete antes
            <input type="number" min="1" max="720" value={settings.followUpHoursBefore} onChange={(event) => setSettings({ ...settings, followUpHoursBefore: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
          </label>
        </div>
        <p className="text-xs text-stone">Fuso horário: {settings.timezone}</p>

        <div className="overflow-x-auto rounded-lg border border-mist bg-white">
          <table className="w-full min-w-[780px] text-left">
            <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone">
              <tr><th className="px-4 py-3">Dia</th><th className="px-4 py-3">Atende</th><th className="px-4 py-3">Intervalos</th><th className="px-4 py-3 text-right">Adicionar</th></tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {settings.weeklyAvailability.map((day) => (
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
                          <button type="button" onClick={() => removeInterval(day.weekday, index)} disabled={!day.enabled} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-30" aria-label={`Remover intervalo ${index + 1}`}>×</button>
                        </div>
                      ))}
                      {day.enabled && day.intervals.length === 0 && <p className="text-xs text-burnt-coral">Adicione ao menos um intervalo.</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => addInterval(day.weekday)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-mist text-lg text-deep-teal hover:border-deep-teal/40" aria-label={`Adicionar intervalo em ${dayNames[day.weekday - 1]}`}>+</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Fechar</button>
          <button type="button" onClick={saveSettings} disabled={busy} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50">Salvar expediente</button>
        </div>
      </section>
      </div>}

      <section aria-labelledby="manual-title" className="border-t border-mist pt-7">
        <h2 id="manual-title" className="font-heading text-lg font-semibold text-slate-ink">Novo agendamento</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px_auto] lg:items-end">
          <label className="text-xs font-semibold text-slate-ink">Cliente
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
              {customers.length === 0 && <option value="">Nenhum cliente</option>}
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · +{customer.phone}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-ink">Data
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
          </label>
          <button type="button" onClick={searchSlots} disabled={busy || !date} className="rounded-lg border border-deep-teal/30 px-4 py-2.5 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:opacity-40">Buscar horários</button>
        </div>
        {slots.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => <button key={slot.startAt} type="button" onClick={() => setSelectedSlot(slot.startAt)} className={`rounded-lg border px-3 py-2 text-sm ${selectedSlot === slot.startAt ? "border-deep-teal bg-deep-teal text-white" : "border-mist bg-white text-slate-ink"}`}>{slot.label}</button>)}
            </div>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação administrativa opcional" className="w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm outline-none focus:border-deep-teal" />
            <button type="button" onClick={createAppointment} disabled={busy || !selectedSlot || !customerId} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Confirmar agendamento</button>
          </div>
        )}
      </section>

      <section aria-labelledby="upcoming-title" className="border-t border-mist pt-7">
        <h2 id="upcoming-title" className="font-heading text-lg font-semibold text-slate-ink">Próximos atendimentos</h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-mist bg-white">
          {appointments.length === 0 ? <p className="px-5 py-12 text-center text-sm text-stone">Nenhum atendimento nos próximos 60 dias.</p> : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Observação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
              <tbody className="divide-y divide-mist">{appointments.map((appointment) => (
                <tr key={appointment._id}><td className="px-4 py-3 font-semibold text-slate-ink">{formatDateTime(appointment.startAt, settings.timezone)}</td><td className="px-4 py-3 text-slate-ink">{appointment.customerName}</td><td className="px-4 py-3 text-stone">{appointment.status === "scheduled" ? "Agendado" : appointment.status === "cancelled" ? "Cancelado" : "Concluído"}</td><td className="px-4 py-3 text-stone">{appointment.notes || "—"}</td><td className="px-4 py-3 text-right">{appointment.status === "scheduled" && <button type="button" onClick={() => cancel(appointment._id)} disabled={busy} className="font-semibold text-burnt-coral hover:underline">Cancelar</button>}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>

      <section aria-labelledby="triggers-title" className="border-t border-mist pt-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="triggers-title" className="font-heading text-lg font-semibold text-slate-ink">Automações agendadas</h2>
            <p className="mt-1 text-xs text-stone">Disparos persistidos que serão processados pelo worker da IA.</p>
          </div>
          <span className="text-xs font-semibold text-stone">{triggers.length} registro(s)</span>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-mist bg-white">
          {triggers.length === 0 ? <p className="px-5 py-12 text-center text-sm text-stone">Nenhuma automação agendada.</p> : (
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone">
                <tr><th className="px-4 py-3">Disparo</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Automação</th><th className="px-4 py-3">Atendimento</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Tentativas</th></tr>
              </thead>
              <tbody className="divide-y divide-mist">
                {triggers.map((trigger) => {
                  const customer = customers.find((item) => item.id === trigger.customerId);
                  const appointment = appointments.find((item) => item._id === trigger.appointmentId);
                  return (
                    <tr key={trigger._id}>
                      <td className="px-4 py-3 font-semibold text-slate-ink">{formatDateTime(trigger.dueAt, settings.timezone)}</td>
                      <td className="px-4 py-3 text-slate-ink">{customer?.name ?? "Cliente não encontrado"}</td>
                      <td className="px-4 py-3 text-slate-ink/75">Lembrete pré-atendimento</td>
                      <td className="px-4 py-3 text-slate-ink/75">{appointment ? formatDateTime(appointment.startAt, settings.timezone) : "Fora da janela atual"}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getTriggerStatusStyle(trigger.status)}`}>{triggerStatusLabels[trigger.status]}</span></td>
                      <td className="px-4 py-3 text-right text-stone">{trigger.attempts}</td>
                    </tr>
                  );
                })}
              </tbody>
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

function getTriggerStatusStyle(status: ScheduledTrigger["status"]) {
  if (status === "failed") return "bg-burnt-coral/10 text-burnt-coral";
  if (status === "completed") return "bg-deep-teal/10 text-deep-teal";
  if (status === "processing") return "bg-slate-ink/10 text-slate-ink";
  if (status === "awaiting_response") return "bg-warm-sand text-slate-ink";
  if (status === "cancelled") return "bg-stone/10 text-stone";
  return "bg-warm-sand text-slate-ink/75";
}

async function requestCalendarData() {
  const response = await fetch("/api/calendar", { cache: "no-store" });
  const data = await response.json() as {
    settings?: Settings;
    appointments?: Appointment[];
    triggers?: ScheduledTrigger[];
    customers?: CustomerOption[];
    error?: string;
  };
  if (!response.ok || !data.settings) {
    throw new Error(data.error ?? "Não foi possível carregar a agenda.");
  }
  return {
    settings: data.settings,
    appointments: data.appointments,
    triggers: data.triggers,
    customers: data.customers,
  };
}