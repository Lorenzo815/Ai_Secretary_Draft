"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, CalendarPlus, MessageCircle, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Trash2, X } from "lucide-react";
import WeekCalendar from "./_components/week-calendar";
import CustomerFormButton from "../clientes/_components/customer-form-button";

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
  confirmationMessageTemplate: string;
}

interface Appointment {
  _id: string;
  providerId: string;
  customerId?: string;
  customerName: string;
  startAt: string;
  endAt: string;
  status: "held" | "scheduled" | "cancelled" | "completed";
  holdExpiresAt?: string;
  eventType?: CalendarEventType;
  customTitle?: string;
  durationMinutes?: number;
  confirmationStatus?: "pending" | "confirmed";
  notes?: string;
  contactPhone?: string;
  source: "assistant" | "manual";
}

interface CalendarAccessEvent {
  _id: string;
  type: "permission" | "blocker";
  title: string;
  startAt: string;
  endAt: string;
  resourceIds: string[];
}

interface CustomerOption { id: string; name: string; phone: string }
type CalendarEventType = string;

const dayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export default function CalendarPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [accessEvents, setAccessEvents] = useState<CalendarAccessEvent[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("consultation");
  const [customTitle, setCustomTitle] = useState("");
  const [customDurationMinutes, setCustomDurationMinutes] = useState(30);
  const [customResourceId, setCustomResourceId] = useState("");
  const [allowOutsideAvailability, setAllowOutsideAvailability] = useState(false);
  const [suggestedSlots, setSuggestedSlots] = useState<Array<{ startAt: string; localTime: string; label: string }>>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [notes, setNotes] = useState("");
  const [editingAppointmentId, setEditingAppointmentId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [editingAccessEventId, setEditingAccessEventId] = useState("");
  const [accessType, setAccessType] = useState<"permission" | "blocker">("permission");
  const [accessTitle, setAccessTitle] = useState("");
  const [accessStartDate, setAccessStartDate] = useState("");
  const [accessStartTime, setAccessStartTime] = useState("08:00");
  const [accessEndDate, setAccessEndDate] = useState("");
  const [accessEndTime, setAccessEndTime] = useState("18:00");
  const [accessResourceIds, setAccessResourceIds] = useState<string[]>([]);
  const [activeResourceId, setActiveResourceId] = useState("doctor");
  const [upcomingQuery, setUpcomingQuery] = useState("");
  const [upcomingStatus, setUpcomingStatus] = useState("");
  const [upcomingEventType, setUpcomingEventType] = useState("");
  const [upcomingResourceId, setUpcomingResourceId] = useState("");
  const deferredUpcomingQuery = useDeferredValue(upcomingQuery);
  const backgroundRefreshInFlight = useRef(false);
  const interactionBlocked = useRef(false);
  interactionBlocked.current = busy || settingsOpen || eventOpen || accessOpen;

  async function refreshCalendar(successMessage?: string) {
    setBusy(true);
    try {
      const data = await requestCalendarData();
      setSettings(data.settings);
      setAppointments(data.appointments ?? []);
      setAccessEvents(data.accessEvents ?? []);
      setCustomers(data.customers ?? []);
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
        setAccessEvents(data.accessEvents ?? []);
        setCustomers(data.customers ?? []);
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
        setAccessEvents(data.accessEvents ?? []);
        setCustomers(data.customers ?? []);
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

  function openCreateEvent(targetDate?: string, targetTime?: string) {
    const nextDate = targetDate ?? date;
    setEditingAppointmentId("");
    setCustomerId("");
    setDate(nextDate);
    setTime(targetTime ?? "");
    setCustomTitle("");
    setCustomDurationMinutes(30);
    setCustomResourceId(settings?.resources[0]?.id ?? "");
    setAllowOutsideAvailability(false);
    setSuggestedSlots([]);
    setSuggestionsLoaded(false);
    setShowAllSuggestions(false);
    setNotes("");
    setFeedback("");
    setEventOpen(true);
  }

  const openEditEvent = useCallback((appointment: Appointment) => {
    if (appointment.status === "cancelled" || appointment.status === "completed") return;
    setEditingAppointmentId(appointment._id);
    setCustomerId(appointment.customerId ?? "");
    setEventType(appointment.eventType ?? settings?.eventTypes[0]?.key ?? "");
    setCustomTitle(appointment.customTitle ?? "");
    setCustomDurationMinutes(appointment.durationMinutes ?? 30);
    setCustomResourceId(appointment.providerId);
    setAllowOutsideAvailability(false);
    setDate(formatDateInput(appointment.startAt, settings?.timezone ?? "America/Sao_Paulo"));
    setTime(formatTimeInput(appointment.startAt, settings?.timezone ?? "America/Sao_Paulo"));
    setNotes(appointment.notes ?? "");
    setFeedback("");
    setEventOpen(true);
  }, [settings]);

  function selectCreatedCustomer(customer: CustomerOption) {
    setCustomers((current) => [...current.filter((item) => item.id !== customer.id), customer]
      .sort((first, second) => first.name.localeCompare(second.name, "pt-BR")));
    setCustomerId(customer.id);
  }

  async function saveAppointment() {
    if (!eventType || !date || !time) return;
    setBusy(true);
    setFeedback("");
    const response = await fetch(editingAppointmentId ? `/api/calendar/appointments/${editingAppointmentId}` : "/api/calendar", {
      method: editingAppointmentId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        startAt: `${date}T${time}`,
        eventType,
        notes,
        ...(eventType === "custom" ? {
          customTitle,
          durationMinutes: customDurationMinutes,
          resourceId: customResourceId,
        } : {}),
        allowOutsideAvailability,
      }),
    });
    const data = await response.json() as { appointment?: Appointment; error?: string };
    if (response.ok && data.appointment) {
      setTime("");
      setNotes("");
      setCustomerId("");
      setEditingAppointmentId("");
      setEventOpen(false);
      await refreshCalendar(editingAppointmentId
        ? `${settings ? getEventTypeName(settings, eventType) : "Evento"} atualizado com sucesso.`
        : `${settings ? getEventTypeName(settings, eventType) : "Evento"} criado com sucesso.`);
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

  async function remove(id: string) {
    if (!window.confirm("Excluir este evento permanentemente? Esta ação não pode ser desfeita.")) return;
    setBusy(true);
    const response = await fetch(`/api/calendar/appointments/${id}?permanent=true`, { method: "DELETE" });
    const data = await response.json() as { error?: string };
    if (response.ok) {
      await refreshCalendar("Evento excluído permanentemente.");
    } else {
      setFeedback(data.error ?? "Não foi possível excluir.");
    }
    setBusy(false);
  }

  function openAccessEvent(type: "permission" | "blocker", accessEvent?: CalendarAccessEvent) {
      const today = new Date().toISOString().slice(0, 10);
      setEditingAccessEventId(accessEvent?._id ?? "");
      setAccessType(type);
      setAccessTitle(accessEvent?.title ?? "");
      setAccessStartDate(accessEvent ? formatDateInput(accessEvent.startAt, settings?.timezone ?? "America/Sao_Paulo") : today);
      setAccessEndDate(accessEvent ? formatDateInput(accessEvent.endAt, settings?.timezone ?? "America/Sao_Paulo") : today);
      setAccessStartTime(accessEvent ? formatTimeInput(accessEvent.startAt, settings?.timezone ?? "America/Sao_Paulo") : type === "permission" ? "08:00" : "12:00");
      setAccessEndTime(accessEvent ? formatTimeInput(accessEvent.endAt, settings?.timezone ?? "America/Sao_Paulo") : type === "permission" ? "18:00" : "13:00");
      setAccessResourceIds(accessEvent?.resourceIds ?? []);
      setFeedback("");
      setAccessOpen(true);
    }

    function toggleAccessResource(resourceId: string) {
      setAccessResourceIds((current) => (
        current.includes(resourceId)
          ? current.filter((id) => id !== resourceId)
          : [...current, resourceId]
      ));
    }

    async function createAccessEvent() {
      if (!accessStartDate || !accessEndDate || !accessStartTime || !accessEndTime) return;
      setBusy(true);
      setFeedback("");
      try {
        const response = await fetch(editingAccessEventId ? `/api/calendar/access-events/${editingAccessEventId}` : "/api/calendar/access-events", {
          method: editingAccessEventId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: accessType,
            title: accessTitle,
            startAt: `${accessStartDate}T${accessStartTime}`,
            endAt: `${accessEndDate}T${accessEndTime}`,
            resourceIds: accessResourceIds,
          }),
        });
        const data = await response.json() as { accessEvent?: CalendarAccessEvent; error?: string };
        if (!response.ok || !data.accessEvent) {
          throw new Error(data.error ?? "Não foi possível criar a regra.");
        }
        setAccessOpen(false);
        await refreshCalendar(editingAccessEventId
          ? "Regra de agenda atualizada."
          : accessType === "permission" ? "Permissão adicionada." : "Bloqueio adicionado.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Não foi possível criar a regra.");
      } finally {
        setBusy(false);
      }
    }

    const loadSuggestions = useCallback(async () => {
        if (!date || !eventType || (eventType === "custom" && (!customResourceId || customDurationMinutes < 5))) {
          setSuggestedSlots([]);
          setSuggestionsLoaded(false);
          return;
        }
        setSuggestionsLoading(true);
        setSuggestionsLoaded(false);
        try {
          const parameters = new URLSearchParams({
            mode: "slots",
            fromDate: date,
            toDate: date,
            eventType,
            ...(eventType === "custom" ? {
              resourceId: customResourceId,
              durationMinutes: String(customDurationMinutes),
            } : {}),
            ...(editingAppointmentId ? { excludeAppointmentId: editingAppointmentId } : {}),
          });
          const response = await fetch(`/api/calendar?${parameters}`, { cache: "no-store" });
          const data = await response.json() as { slots?: Array<{ startAt: string; localTime: string; label: string }>; error?: string };
          if (!response.ok) throw new Error(data.error ?? "Não foi possível sugerir encaixes.");
          setSuggestedSlots(data.slots ?? []);
          setSuggestionsLoaded(true);
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : "Não foi possível sugerir encaixes.");
          setSuggestedSlots([]);
          setSuggestionsLoaded(true);
        } finally {
          setSuggestionsLoading(false);
        }
      }, [date, eventType, customResourceId, customDurationMinutes, editingAppointmentId]);

    useEffect(() => {
      if (!eventOpen || allowOutsideAvailability) return;
      const timeout = window.setTimeout(() => void loadSuggestions(), 250);
      return () => window.clearTimeout(timeout);
    }, [eventOpen, allowOutsideAvailability, loadSuggestions]);

    async function setAppointmentConfirmation(id: string, confirmationStatus: "pending" | "confirmed") {
        setBusy(true);
        try {
          const response = await fetch(`/api/calendar/appointments/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmationStatus }),
          });
          const data = await response.json() as { error?: string };
          if (!response.ok) throw new Error(data.error ?? "Não foi possível alterar a confirmação.");
          await refreshCalendar(confirmationStatus === "confirmed"
            ? "Atendimento marcado como confirmado."
            : "Confirmação removida. O atendimento voltou para agendado.");
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : "Não foi possível alterar a confirmação.");
        } finally {
          setBusy(false);
        }
      }

    async function removeAccessEvent(id: string) {
      setBusy(true);
      setFeedback("");
      try {
        const response = await fetch(`/api/calendar/access-events/${id}`, { method: "DELETE" });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível remover a regra.");
        await refreshCalendar("Regra removida.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Não foi possível remover a regra.");
      } finally {
        setBusy(false);
      }
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

  function addResource() {
    if (!settings || settings.resources.length >= 20) return;
    const id = `professional_${Date.now().toString(36)}`;
    const weeklyAvailability = settings.weeklyAvailability.map((day) => ({
      ...day,
      intervals: day.intervals.map((interval) => ({ ...interval })),
    }));
    setSettings({
      ...settings,
      resources: [
        ...settings.resources,
        { id, name: "Novo profissional", weeklyAvailability },
      ],
    });
    setActiveResourceId(id);
  }

  function removeResource(resourceId: string) {
    if (!settings || defaultResourceIds.has(resourceId)) return;
    if (settings.eventTypes.some((eventType) => eventType.resourceId === resourceId)) {
      setFeedback("Antes de remover o profissional, atribua seus tipos de evento a outra pessoa.");
      return;
    }
    const resources = settings.resources.filter((resource) => resource.id !== resourceId);
    setSettings({ ...settings, resources });
    setAccessResourceIds((current) => current.filter((id) => id !== resourceId));
    setActiveResourceId(resources[0]?.id ?? "");
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
      eventTypes: [...current.eventTypes, {
        key,
        name: "Novo tipo",
        color: "#0F766E",
        durationMinutes: current.slotDurationMinutes,
        resourceId: current.resources.some((resource) => resource.id === activeResourceId)
          ? activeResourceId
          : current.resources[0].id,
      }],
    } : current);
  }

  function removeEventType(key: string) {
    setSettings((current) => current && current.eventTypes.length > 1 ? {
      ...current,
      eventTypes: current.eventTypes.filter((eventType) => eventType.key !== key),
    } : current);
    setEventType((current) => current === key ? "" : current);
  }

  const filteredUpcomingAppointments = useMemo(() => {
    const normalizedQuery = normalizeSearch(deferredUpcomingQuery);
    return appointments.filter((appointment) => {
      if (upcomingStatus && !matchesAppointmentStatus(appointment, upcomingStatus)) return false;
      if (upcomingEventType && appointment.eventType !== upcomingEventType) return false;
      if (upcomingResourceId && appointment.providerId !== upcomingResourceId) return false;
      if (!normalizedQuery) return true;
      return normalizeSearch([
        appointment.customerName,
        appointment.contactPhone,
        appointment.notes,
        appointment.customTitle,
        settings ? getEventTypeName(settings, appointment.eventType) : "",
      ].filter(Boolean).join(" ")).includes(normalizedQuery);
    });
  }, [appointments, deferredUpcomingQuery, settings, upcomingEventType, upcomingResourceId, upcomingStatus]);

  if (!settings) {
    return <p className="py-20 text-center text-sm text-stone">{feedback || "Carregando agenda..."}</p>;
  }
  const activeResource = settings.resources.find((resource) => resource.id === activeResourceId);
  const activeResourceIsRequired = defaultResourceIds.has(activeResourceId);
  const activeResourceIsInUse = settings.eventTypes.some((eventType) => eventType.resourceId === activeResourceId);
  const selectedEventType = settings.eventTypes.find((item) => item.key === eventType);
  const selectedEventResource = settings.resources.find((resource) => resource.id === (eventType === "custom" ? customResourceId : selectedEventType?.resourceId));

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
            <button type="button" onClick={() => openAccessEvent("permission")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-deep-teal px-3 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5"><ShieldCheck className="h-4 w-4" />Permitir horários</button>
            <button type="button" onClick={() => openAccessEvent("blocker")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-burnt-coral/40 px-3 text-sm font-semibold text-burnt-coral hover:bg-burnt-coral/5"><Ban className="h-4 w-4" />Bloquear período</button>
            <button type="button" onClick={() => openCreateEvent()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-deep-teal px-3 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5"><CalendarPlus className="h-4 w-4" />Novo evento</button>
            <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-deep-teal px-3 text-sm font-semibold text-white hover:bg-forest-teal"><Settings2 className="h-4 w-4" />Configurar agenda</button>
          </div>
        </div>
      </header>

      <details className="rounded-lg border border-mist bg-white">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-ink">
          Janelas efetivas de atendimento <span className="ml-2 text-xs font-normal text-stone">({accessEvents.length} regras)</span>
        </summary>
      <section aria-labelledby="access-events-title" className="border-t border-mist p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-deep-teal">Permissões e bloqueios</p>
            <h2 id="access-events-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">Janelas efetivas de atendimento</h2>
            <p className="mt-1 text-xs leading-5 text-stone">Um horário só pode ser reservado quando estiver no expediente semanal e dentro de uma permissão aplicável. Qualquer bloqueio prevalece.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accessEvents.map((accessEvent) => (
            <article key={accessEvent._id} className={`border-l-4 bg-white p-4 shadow-sm ${accessEvent.type === "permission" ? "border-emerald-500" : "border-burnt-coral"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-[10px] font-bold uppercase ${accessEvent.type === "permission" ? "text-emerald-700" : "text-burnt-coral"}`}>{accessEvent.type === "permission" ? "Permissão" : "Bloqueio"}</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-ink">{accessEvent.title}</h3>
                </div>
                <div className="flex shrink-0">
                  <button type="button" onClick={() => openAccessEvent(accessEvent.type, accessEvent)} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-md text-stone hover:bg-deep-teal/5 hover:text-deep-teal disabled:opacity-40" aria-label={`Editar ${accessEvent.title}`}><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void removeAccessEvent(accessEvent._id)} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-md text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-40" aria-label={`Remover ${accessEvent.title}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <p className="mt-2 text-xs text-stone">{formatDateTime(accessEvent.startAt, settings.timezone)} até {formatDateTime(accessEvent.endAt, settings.timezone)}</p>
              <p className="mt-1 text-xs text-stone">{accessEvent.resourceIds.length === 0 ? "Todos os profissionais" : accessEvent.resourceIds.map((id) => settings.resources.find((resource) => resource.id === id)?.name ?? id).join(", ")}</p>
            </article>
          ))}
          {accessEvents.length === 0 && <div className="rounded-lg border border-dashed border-mist bg-soft-ivory p-5 text-sm text-stone md:col-span-2 xl:col-span-3">Nenhuma permissão cadastrada. Até que uma permissão seja criada, nenhum horário será considerado disponível.</div>}
        </div>
      </section>
      </details>

      <WeekCalendar timezone={settings.timezone} eventTypes={settings.eventTypes} resources={settings.resources} slotDurationMinutes={settings.slotDurationMinutes} refreshKey={calendarRefreshKey} onEditEvent={openEditEvent} />

      {accessOpen && createPortal(<div className="fixed inset-0 z-50 flex justify-end bg-slate-ink/45" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccessOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="access-event-title" className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-xs font-semibold uppercase ${accessType === "permission" ? "text-emerald-700" : "text-burnt-coral"}`}>{accessType === "permission" ? "Permissão" : "Bloqueio"}</p>
              <h2 id="access-event-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">{editingAccessEventId ? "Editar regra" : accessType === "permission" ? "Permitir agendamentos" : "Bloquear agenda"}</h2>
              <p className="mt-1 text-xs leading-5 text-stone">O intervalo pode durar minutos ou vários dias. Sem profissionais selecionados, a regra vale para todos.</p>
            </div>
            <button type="button" onClick={() => setAccessOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-soft-ivory hover:text-slate-ink" aria-label="Fechar regra"><X className="h-4 w-4" /></button>
          </div>
          <label className="mt-6 block text-xs font-semibold text-slate-ink">Título
            <input value={accessTitle} maxLength={120} onChange={(event) => setAccessTitle(event.target.value)} placeholder={accessType === "permission" ? "Ex.: Atendimento de outubro" : "Ex.: Congresso"} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-ink">Data inicial<input type="date" value={accessStartDate} onChange={(event) => setAccessStartDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist px-3 py-2.5 text-sm font-normal" /></label>
            <label className="text-xs font-semibold text-slate-ink">Hora inicial<input type="time" value={accessStartTime} onChange={(event) => setAccessStartTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist px-3 py-2.5 text-sm font-normal" /></label>
            <label className="text-xs font-semibold text-slate-ink">Data final<input type="date" value={accessEndDate} onChange={(event) => setAccessEndDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist px-3 py-2.5 text-sm font-normal" /></label>
            <label className="text-xs font-semibold text-slate-ink">Hora final<input type="time" value={accessEndTime} onChange={(event) => setAccessEndTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist px-3 py-2.5 text-sm font-normal" /></label>
          </div>
          <fieldset className="mt-5">
            <legend className="text-xs font-semibold text-slate-ink">Profissionais</legend>
            <p className="mt-1 text-xs text-stone">Nenhuma seleção significa todos os profissionais.</p>
            <div className="mt-3 space-y-2">
              {settings.resources.map((resource) => <label key={resource.id} className="flex items-center gap-3 rounded-md border border-mist px-3 py-3 text-sm text-slate-ink"><input type="checkbox" checked={accessResourceIds.includes(resource.id)} onChange={() => toggleAccessResource(resource.id)} className="h-4 w-4 accent-deep-teal" />{resource.name}</label>)}
            </div>
          </fieldset>
          <div className="mt-7 flex justify-end gap-2">
            <button type="button" onClick={() => setAccessOpen(false)} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Cancelar</button>
            <button type="button" onClick={() => void createAccessEvent()} disabled={busy || !accessStartDate || !accessEndDate || !accessStartTime || !accessEndTime} className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${accessType === "permission" ? "bg-deep-teal hover:bg-forest-teal" : "bg-burnt-coral"}`}>{busy ? "Salvando..." : editingAccessEventId ? "Salvar alterações" : accessType === "permission" ? "Criar permissão" : "Criar bloqueio"}</button>
          </div>
        </section>
      </div>, document.body)}

      {eventOpen && createPortal(<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-ink/45 p-4 py-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="event-title" className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="event-title" className="font-heading text-lg font-semibold text-slate-ink">{editingAppointmentId ? "Editar evento" : "Novo evento"}</h2>
              <p className="mt-1 text-xs leading-5 text-stone">Eventos manuais não expiram. O override opcional permite sair do expediente, mas bloqueios e conflitos continuam protegidos.</p>
            </div>
            <button type="button" onClick={() => setEventOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-soft-ivory hover:text-slate-ink" aria-label="Fechar evento"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-ink">Tipo de evento
              <select value={eventType} onChange={(event) => setEventType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                {settings.eventTypes.map((item) => <option key={item.key} value={item.key}>{item.name} · {item.durationMinutes} min</option>)}
                <option value="custom">Personalizado · duração livre</option>
              </select>
              {selectedEventResource && <span className="mt-1.5 block font-normal text-stone">{selectedEventResource.name}</span>}
            </label>
            <div>
              <label className="text-xs font-semibold text-slate-ink">Cliente
                <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                  <option value="">Sem cliente</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · +{customer.phone}</option>)}
                </select>
              </label>
              <div className="mt-2"><CustomerFormButton compact onCreated={selectCreatedCustomer} /></div>
            </div>
            <label className="text-xs font-semibold text-slate-ink">Data
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
            </label>
            <label className="text-xs font-semibold text-slate-ink">Hora
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
            </label>
            {eventType === "custom" && (
              <>
                <label className="text-xs font-semibold text-slate-ink">Título
                  <input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} maxLength={120} placeholder="Ex.: Reunião administrativa" className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
                </label>
                <label className="text-xs font-semibold text-slate-ink">Profissional
                  <select value={customResourceId} onChange={(event) => setCustomResourceId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                    {settings.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-ink">Duração em minutos
                  <input type="number" min={5} max={720} step={5} value={customDurationMinutes} onChange={(event) => setCustomDurationMinutes(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
                </label>
              </>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-ink">
              <input type="checkbox" checked={allowOutsideAvailability} onChange={(event) => setAllowOutsideAvailability(event.target.checked)} className="h-4 w-4 accent-deep-teal" />
              Permitir fora do expediente/permissões
            </label>
            {date && <button type="button" onClick={() => void loadSuggestions()} disabled={suggestionsLoading || allowOutsideAvailability} className="rounded-md border border-deep-teal/30 px-3 py-2 text-xs font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:opacity-40">{suggestionsLoading ? "Buscando encaixes..." : "Atualizar encaixes"}</button>}
          </div>
          {!allowOutsideAvailability && suggestionsLoaded && suggestedSlots.length === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Nenhum bloco livre deste tipo foi encontrado no dia selecionado.</p>
          )}
          {!allowOutsideAvailability && suggestedSlots.length > 0 && (
            <div className="mt-3 rounded-lg bg-soft-ivory p-3">
              <p className="text-xs font-semibold text-slate-ink">Próximos blocos que comportam este evento</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(showAllSuggestions ? suggestedSlots : suggestedSlots.slice(0, 3)).map((slot) => <button key={slot.startAt} type="button" onClick={() => setTime(slot.localTime)} className={`rounded-md border px-3 py-2 text-xs font-semibold hover:border-deep-teal ${time === slot.localTime ? "border-deep-teal bg-deep-teal text-white" : "border-mist bg-white text-deep-teal"}`}>{slot.localTime}</button>)}
              </div>
              {suggestedSlots.length > 3 && <button type="button" onClick={() => setShowAllSuggestions((current) => !current)} className="mt-2 text-xs font-semibold text-deep-teal hover:underline">{showAllSuggestions ? "Mostrar só os 3 próximos" : `Ver outros ${suggestedSlots.length - 3} horários`}</button>}
            </div>
          )}

          <label className="mt-5 block text-xs font-semibold text-slate-ink">Observação
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação administrativa opcional" className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>

          {feedback && <p className="mt-4 rounded-md border border-burnt-coral/30 bg-burnt-coral/5 px-3 py-2.5 text-sm leading-5 text-burnt-coral" role="alert">{feedback}</p>}

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setEventOpen(false)} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Cancelar</button>
            <button type="button" onClick={saveAppointment} disabled={busy || !eventType || !date || !time || (eventType === "custom" && (!customTitle.trim() || !customResourceId || customDurationMinutes < 5))} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-40">{busy ? "Salvando..." : editingAppointmentId ? "Salvar alterações" : "Criar evento"}</button>
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
        <label className="block text-xs font-semibold text-slate-ink">
          Mensagem padrão para abrir no WhatsApp Web
          <textarea value={settings.confirmationMessageTemplate} onChange={(event) => setSettings({ ...settings, confirmationMessageTemplate: event.target.value })} maxLength={500} rows={3} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal" />
          <span className="mt-1 block font-normal text-stone">Variáveis disponíveis: {"{nome}"}, {"{data}"}, {"{hora}"}, {"{tipo}"} e {"{evento}"}.</span>
        </label>
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
                <label className="text-xs font-semibold text-slate-ink">Profissional
                  <select value={eventType.resourceId} onChange={(event) => updateEventType(eventType.key, { resourceId: event.target.value })} className="mt-1 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal">
                    {settings.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => removeEventType(eventType.key)} disabled={settings.eventTypes.length === 1} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-burnt-coral/5 hover:text-burnt-coral disabled:opacity-30" aria-label={`Remover ${eventType.name}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="professionals-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="professionals-title" className="text-sm font-semibold text-slate-ink">Profissionais</h3>
              <p className="mt-1 text-xs text-stone">Adicione profissionais e configure um expediente independente para cada um.</p>
            </div>
            <button type="button" onClick={addResource} disabled={settings.resources.length >= 20} className="rounded-lg border border-deep-teal/30 px-3 py-2 text-xs font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:opacity-40">Adicionar profissional</button>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-ink">Agenda do profissional
            <select value={activeResourceId} onChange={(event) => setActiveResourceId(event.target.value)} className="mt-1.5 block min-h-10 rounded-md border border-mist bg-white px-3 text-sm font-normal">
              {settings.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </label>
          <label className="min-w-64 flex-1 text-xs font-semibold text-slate-ink">Nome exibido
            <input value={settings.resources.find((resource) => resource.id === activeResourceId)?.name ?? ""} onChange={(event) => updateResourceName(event.target.value)} className="mt-1.5 block min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
          </label>
          <button
            type="button"
            onClick={() => removeResource(activeResourceId)}
            disabled={activeResourceIsRequired || activeResourceIsInUse}
            title={activeResourceIsRequired
              ? "Os profissionais padrão não podem ser removidos."
              : activeResourceIsInUse
                ? "Atribua os tipos de evento a outro profissional antes de remover."
                : `Remover ${activeResource?.name ?? "profissional"}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-burnt-coral/40 px-3 text-xs font-semibold text-burnt-coral hover:bg-burnt-coral/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />Remover
          </button>
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
        </section>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-mist bg-white px-5 py-4 sm:px-7">
          <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-lg border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink hover:bg-soft-ivory">Fechar</button>
          <button type="button" onClick={saveSettings} disabled={busy} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50">Salvar expediente</button>
        </div>
      </section>
      </div>, document.body)}

      <details open className="rounded-lg border border-mist bg-white">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-ink">
          Próximos atendimentos <span className="ml-2 text-xs font-normal text-stone">({filteredUpcomingAppointments.length} de {appointments.length})</span>
        </summary>
      <section aria-labelledby="upcoming-title" className="border-t border-mist p-5">
        <h2 id="upcoming-title" className="sr-only">Próximos atendimentos</h2>
        <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(240px,1fr)_180px_190px_190px]">
          <label className="relative">
            <span className="sr-only">Pesquisar próximos atendimentos</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
            <input value={upcomingQuery} onChange={(event) => setUpcomingQuery(event.target.value)} placeholder="Cliente, telefone ou observação" className="w-full rounded-md border border-mist bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-deep-teal" />
          </label>
          <select value={upcomingStatus} onChange={(event) => setUpcomingStatus(event.target.value)} className="rounded-md border border-mist bg-white px-3 py-2.5 text-sm outline-none focus:border-deep-teal" aria-label="Filtrar próximos atendimentos por situação">
            <option value="">Todas as situações</option>
            <option value="pending">Agendado · confirmar</option>
            <option value="confirmed">Confirmados</option>
            <option value="held">Aguardando sinal</option>
            <option value="completed">Concluídos</option>
            <option value="cancelled">Cancelados</option>
          </select>
          <select value={upcomingEventType} onChange={(event) => setUpcomingEventType(event.target.value)} className="rounded-md border border-mist bg-white px-3 py-2.5 text-sm outline-none focus:border-deep-teal" aria-label="Filtrar próximos atendimentos por tipo">
            <option value="">Todos os tipos</option>
            {settings.eventTypes.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
            <option value="custom">Personalizados</option>
          </select>
          <select value={upcomingResourceId} onChange={(event) => setUpcomingResourceId(event.target.value)} className="rounded-md border border-mist bg-white px-3 py-2.5 text-sm outline-none focus:border-deep-teal" aria-label="Filtrar próximos atendimentos por profissional">
            <option value="">Todos os profissionais</option>
            {settings.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto rounded-lg border border-mist bg-white">
          {filteredUpcomingAppointments.length === 0 ? <p className="px-5 py-12 text-center text-sm text-stone">{appointments.length === 0 ? "Nenhum atendimento nos próximos 60 dias." : "Nenhum atendimento corresponde aos filtros."}</p> : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-soft-ivory text-xs font-semibold uppercase text-stone"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Profissional</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Observação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
              <tbody className="divide-y divide-mist">{filteredUpcomingAppointments.map((appointment) => {
                const pendingConfirmation = appointment.status === "scheduled"
                  && (appointment.confirmationStatus === "pending" || (!appointment.confirmationStatus && appointment.source === "manual"));
                return (
                  <tr key={appointment._id}>
                    <td className="px-4 py-3 font-semibold text-slate-ink">{formatAppointmentDateTime(appointment.startAt, settings.timezone)}</td>
                    <td className="px-4 py-3 text-slate-ink">{appointment.customerName || "Sem cliente"}</td>
                    <td className="px-4 py-3 text-stone">{appointment.customTitle || getEventTypeName(settings, appointment.eventType)}</td>
                    <td className="px-4 py-3 text-stone">{getResourceName(settings, appointment.providerId)}</td>
                    <td className="px-4 py-3 text-stone">{appointment.status === "held" ? "Aguardando sinal" : pendingConfirmation ? "Agendado · confirmar" : appointment.status === "scheduled" ? "Confirmado" : appointment.status === "cancelled" ? "Cancelado" : "Concluído"}</td>
                    <td className="px-4 py-3 text-stone">{appointment.notes || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {appointment.contactPhone && <a href={buildWhatsAppUrl(appointment, settings)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline" title="Abrir conversa no WhatsApp Web com a mensagem padrão"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
                        {pendingConfirmation
                          ? <button type="button" onClick={() => void setAppointmentConfirmation(appointment._id, "confirmed")} disabled={busy} className="font-semibold text-deep-teal hover:underline disabled:opacity-50">Confirmar</button>
                          : appointment.status === "scheduled" && <button type="button" onClick={() => void setAppointmentConfirmation(appointment._id, "pending")} disabled={busy} className="font-semibold text-amber-700 hover:underline disabled:opacity-50">Desconfirmar</button>}
                        {(appointment.status === "scheduled" || appointment.status === "held") && <button type="button" onClick={() => openEditEvent(appointment)} disabled={busy} className="font-semibold text-deep-teal hover:underline disabled:opacity-50">Editar</button>}
                        {appointment.status === "scheduled" && <button type="button" onClick={() => cancel(appointment._id)} disabled={busy} className="font-semibold text-burnt-coral hover:underline disabled:opacity-50">Cancelar</button>}
                        <button type="button" onClick={() => void remove(appointment._id)} disabled={busy} className="font-semibold text-burnt-coral hover:underline disabled:opacity-50">Excluir</button>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      </section>
      </details>

      <p className={`text-sm ${feedback.includes("não") || feedback.includes("Falha") ? "text-burnt-coral" : "text-deep-teal"}`} aria-live="polite">{feedback}</p>
    </div>
  );
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function formatAppointmentDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function buildWhatsAppUrl(appointment: Appointment, settings: Settings) {
  const local = new Date(appointment.startAt);
  const data = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: settings.timezone,
  }).format(local);
  const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: settings.timezone }).format(local);
  const tipo = getEventTypeName(settings, appointment.eventType);
  const evento = appointment.customTitle || tipo;
  const message = settings.confirmationMessageTemplate
    .replaceAll("{nome}", appointment.customerName || "cliente")
    .replaceAll("{data}", data)
    .replaceAll("{hora}", hora)
    .replaceAll("{tipo}", tipo)
    .replaceAll("{evento}", evento);
  const phone = (appointment.contactPhone ?? "").replace(/\D/g, "");
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
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

function formatDateInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatTimeInput(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(value));
}

async function requestCalendarData() {
  const response = await fetch("/api/calendar", { cache: "no-store" });
  const data = await response.json() as {
    settings?: Settings;
    appointments?: Appointment[];
    accessEvents?: CalendarAccessEvent[];
    customers?: CustomerOption[];
    error?: string;
  };
  if (!response.ok || !data.settings) {
    throw new Error(data.error ?? "Não foi possível carregar a agenda.");
  }
  return {
    settings: data.settings,
    appointments: data.appointments,
    accessEvents: data.accessEvents,
    customers: data.customers,
  };
}

function getEventTypeName(settings: Settings, key?: string) {
  return settings.eventTypes.find((eventType) => eventType.key === key)?.name ?? "Tipo removido";
}

function getResourceName(settings: Settings, id: string) {
  return settings.resources.find((resource) => resource.id === id)?.name ?? "Profissional removido";
}

const defaultResourceIds = new Set(["doctor", "technician"]);