"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, CalendarPlus, Pencil, Plus, RefreshCw, Repeat2, Search, Settings2, ShieldCheck, Trash2, X } from "lucide-react";
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

interface CalendarAccessEvent {
  _id: string;
  type: "permission" | "blocker";
  title: string;
  startAt: string;
  endAt: string;
  resourceIds: string[];
}

interface CustomerOption { id: string; name: string; phone: string; createdAt?: string }
type CalendarEventType = string;

const dayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export default function CalendarPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
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
  const [editScope, setEditScope] = useState<"occurrence" | "series">("occurrence");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatFrequency, setRepeatFrequency] = useState<"daily" | "weekly" | "biweekly" | "monthly">("weekly");
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatEndMode, setRepeatEndMode] = useState<"count" | "until">("count");
  const [repeatCount, setRepeatCount] = useState(4);
  const [repeatUntilDate, setRepeatUntilDate] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pendingSeriesAction, setPendingSeriesAction] = useState<{
    appointment: Appointment;
    mode: "cancel" | "delete";
  } | null>(null);
  const [editingAccessEventId, setEditingAccessEventId] = useState("");
  const [accessType, setAccessType] = useState<"permission" | "blocker">("permission");
  const [accessTitle, setAccessTitle] = useState("");
  const [accessStartDate, setAccessStartDate] = useState("");
  const [accessStartTime, setAccessStartTime] = useState("08:00");
  const [accessEndDate, setAccessEndDate] = useState("");
  const [accessEndTime, setAccessEndTime] = useState("18:00");
  const [accessResourceIds, setAccessResourceIds] = useState<string[]>([]);
  const [activeResourceId, setActiveResourceId] = useState("doctor");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerSort, setCustomerSort] = useState<"recent" | "alphabetical">("recent");
  const deferredCustomerQuery = useDeferredValue(customerQuery);
  const backgroundRefreshInFlight = useRef(false);
  const whatsappWindowRef = useRef<Window | null>(null);
  const interactionBlocked = useRef(false);
  interactionBlocked.current = busy || settingsOpen || eventOpen || accessOpen || Boolean(pendingSeriesAction);

  async function refreshCalendar(successMessage?: string) {
    setBusy(true);
    try {
      const data = await requestCalendarData();
      setSettings(data.settings);
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
    const nextDate = targetDate || date || formatDateInput(
      new Date().toISOString(),
      settings?.timezone ?? "America/Sao_Paulo",
    );
    setEditingAppointmentId("");
    setEditScope("occurrence");
    setRepeatEnabled(false);
    setRepeatFrequency("weekly");
    setRepeatInterval(1);
    setRepeatEndMode("count");
    setRepeatCount(4);
    setRepeatUntilDate("");
    setCustomerId("");
    setCustomerQuery("");
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
    setEditScope("occurrence");
    setRepeatEnabled(Boolean(appointment.recurrence));
    setRepeatFrequency(
      appointment.recurrence?.frequency === "weekly" && appointment.recurrence.interval === 2
        ? "biweekly"
        : appointment.recurrence?.frequency ?? "weekly",
    );
    setRepeatInterval(appointment.recurrence?.interval ?? 1);
    setCustomerId(appointment.customerId ?? "");
    setCustomerQuery("");
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
    setCustomers((current) => [
      ...current.filter((item) => item.id !== customer.id),
      { ...customer, createdAt: new Date().toISOString() },
    ]);
    setCustomerId(customer.id);
    setCustomerQuery("");
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
        ...(editingAppointmentId ? { scope: editScope } : {}),
        ...(!editingAppointmentId && repeatEnabled ? {
          recurrence: {
            frequency: repeatFrequency === "biweekly" ? "weekly" : repeatFrequency,
            interval: repeatFrequency === "biweekly" ? 2 : repeatInterval,
            endMode: repeatEndMode,
            ...(repeatEndMode === "count" ? { count: repeatCount } : { untilDate: repeatUntilDate }),
          },
        } : {}),
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

  async function cancel(appointment: Appointment) {
    if (appointment.recurrence) {
      setPendingSeriesAction({ appointment, mode: "cancel" });
      return;
    }
    await changeAppointmentState(appointment, "occurrence", false);
  }

  async function remove(appointment: Appointment) {
    if (appointment.recurrence) {
      setPendingSeriesAction({ appointment, mode: "delete" });
      return;
    }
    if (!window.confirm("Excluir este evento permanentemente? Esta ação não pode ser desfeita.")) return;
    await changeAppointmentState(appointment, "occurrence", true);
  }

  async function changeAppointmentState(
    appointment: Appointment,
    scope: "occurrence" | "series",
    permanent: boolean,
  ) {
    setBusy(true);
    setPendingSeriesAction(null);
    try {
      const parameters = new URLSearchParams({ scope });
      if (permanent) parameters.set("permanent", "true");
      const response = await fetch(`/api/calendar/appointments/${appointment._id}?${parameters}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? (permanent ? "Não foi possível excluir." : "Não foi possível cancelar."));
      await refreshCalendar(permanent
        ? scope === "series" ? "Ocorrência atual e próximas excluídas permanentemente." : "Evento excluído permanentemente."
        : scope === "series" ? "Ocorrência atual e próximas canceladas." : "Evento cancelado.");
    } catch (changeError) {
      setFeedback(changeError instanceof Error ? changeError.message : "Não foi possível alterar o evento.");
    } finally {
      setBusy(false);
    }
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
            ...(allowOutsideAvailability ? { allowOutsideAvailability: "true" } : {}),
          });
          const response = await fetch(`/api/calendar?${parameters}`, { cache: "no-store" });
          const data = await response.json() as { slots?: Array<{ startAt: string; localTime: string; label: string }>; error?: string };
          if (!response.ok) throw new Error(data.error ?? "Não foi possível sugerir encaixes.");
          const slots = data.slots ?? [];
          setSuggestedSlots(slots);
          setTime((current) => current || slots[0]?.localTime || "");
          setSuggestionsLoaded(true);
        } catch (error) {
          setFeedback(error instanceof Error ? error.message : "Não foi possível sugerir encaixes.");
          setSuggestedSlots([]);
          setSuggestionsLoaded(true);
        } finally {
          setSuggestionsLoading(false);
        }
      }, [date, eventType, customResourceId, customDurationMinutes, editingAppointmentId, allowOutsideAvailability]);

    useEffect(() => {
      if (!eventOpen) return;
      const timeout = window.setTimeout(() => void loadSuggestions(), 250);
      return () => window.clearTimeout(timeout);
    }, [eventOpen, loadSuggestions]);

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

    async function openAppointmentWhatsApp(appointment: Appointment) {
      const currentPopup = whatsappWindowRef.current && !whatsappWindowRef.current.closed
        ? whatsappWindowRef.current
        : null;
      const popup = currentPopup ?? window.open("", "oria-calendar-whatsapp");
      if (!popup) {
        setFeedback("O navegador bloqueou a nova aba. Permita pop-ups para abrir o WhatsApp Web.");
        return;
      }
      whatsappWindowRef.current = popup;
      let openedBlankWindow = false;
      if (!currentPopup) {
        try {
          openedBlankWindow = popup.location.href === "about:blank";
          if (openedBlankWindow) popup.opener = null;
        } catch {
          // A named WhatsApp tab from an earlier page load is already cross-origin.
        }
      }
      setFeedback("");
      try {
        let phone = appointment.contactPhone ?? "";
        if (appointment.customerId) {
          const response = await fetch(`/api/customers/${appointment.customerId}`, { cache: "no-store" });
          const data = await response.json() as { customer?: CustomerOption; error?: string };
          if (!response.ok || !data.customer) {
            throw new Error(data.error ?? "Não foi possível consultar o cadastro atual do cliente.");
          }
          phone = data.customer.phone;
          setCustomers((current) => current.map((customer) => (
            customer.id === data.customer!.id ? data.customer! : customer
          )));
        }
        const normalizedPhone = phone.replace(/\D/g, "");
        if (!normalizedPhone) {
          throw new Error("O cliente não possui um WhatsApp principal cadastrado.");
        }
        popup.location.href = buildWhatsAppUrl(appointment, settings!, normalizedPhone);
        popup.focus();
      } catch (error) {
        if (openedBlankWindow) {
          popup.close();
          whatsappWindowRef.current = null;
        }
        setFeedback(error instanceof Error ? error.message : "Não foi possível abrir o WhatsApp Web.");
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

  const visibleCustomerOptions = useMemo(() => {
    const normalizedQuery = normalizeSearch(deferredCustomerQuery);
    const options = customers
      .filter((customer) => !normalizedQuery || normalizeSearch(customer.name).includes(normalizedQuery))
      .sort((first, second) => {
        if (customerSort === "recent") {
          const dateDifference = (Date.parse(second.createdAt ?? "") || 0) - (Date.parse(first.createdAt ?? "") || 0);
          if (dateDifference) return dateDifference;
        }
        return first.name.localeCompare(second.name, "pt-BR", { sensitivity: "base" })
          || first.phone.localeCompare(second.phone);
      });
    const selectedCustomer = customerId ? customers.find((customer) => customer.id === customerId) : undefined;
    if (selectedCustomer && !options.some((customer) => customer.id === selectedCustomer.id)) {
      options.unshift(selectedCustomer);
    }
    return options;
  }, [customerId, customerSort, customers, deferredCustomerQuery]);

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

      <WeekCalendar
        timezone={settings.timezone}
        eventTypes={settings.eventTypes}
        resources={settings.resources}
        slotDurationMinutes={settings.slotDurationMinutes}
        refreshKey={calendarRefreshKey}
        onEditEvent={openEditEvent}
        onOpenWhatsApp={openAppointmentWhatsApp}
        onSetConfirmation={setAppointmentConfirmation}
        onCancelEvent={cancel}
        onDeleteEvent={remove}
        busy={busy}
      />

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
              <p className="mt-1 text-xs leading-5 text-stone">Eventos manuais não expiram. O override ignora expediente, permissões e bloqueios; somente conflitos com outros eventos continuam protegidos.</p>
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
              <span className="text-xs font-semibold text-slate-ink">Cliente</span>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <label className="relative">
                  <span className="sr-only">Pesquisar cliente por nome</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
                  <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Pesquisar por nome" className="w-full rounded-lg border border-mist bg-white py-2.5 pl-9 pr-3 text-sm font-normal outline-none focus:border-deep-teal" />
                </label>
                <select value={customerSort} onChange={(event) => setCustomerSort(event.target.value as typeof customerSort)} aria-label="Ordenar clientes" className="rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal">
                  <option value="recent">Recentes</option>
                  <option value="alphabetical">A–Z</option>
                </select>
              </div>
              <label className="sr-only" htmlFor="calendar-customer">Selecionar cliente</label>
              <select id="calendar-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-2 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                  <option value="">Sem cliente</option>
                  {visibleCustomerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · +{customer.phone}</option>)}
              </select>
              {customerQuery.trim() && visibleCustomerOptions.length === 0 && <p className="mt-1.5 text-xs text-stone">Nenhum cliente encontrado.</p>}
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

          {editingAppointmentId && repeatEnabled ? (
            <fieldset className="mt-4 rounded-lg border border-deep-teal/20 bg-deep-teal/5 p-4">
              <legend className="px-1 text-xs font-semibold text-slate-ink">Alterar evento recorrente</legend>
              <p className="mb-3 text-xs leading-5 text-stone">Ocorrências passadas sempre são preservadas.</p>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-ink">
                  <input type="radio" name="edit-scope" value="occurrence" checked={editScope === "occurrence"} onChange={() => setEditScope("occurrence")} className="accent-deep-teal" />
                  Somente esta ocorrência
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-ink">
                  <input type="radio" name="edit-scope" value="series" checked={editScope === "series"} onChange={() => setEditScope("series")} className="accent-deep-teal" />
                  Esta e as próximas da série
                </label>
              </div>
            </fieldset>
          ) : !editingAppointmentId && (
            <section className="mt-4 rounded-lg border border-mist bg-soft-ivory/60 p-4" aria-labelledby="recurrence-title">
              <h3 id="recurrence-title" className="sr-only">Recorrência</h3>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-ink">
                <input type="checkbox" checked={repeatEnabled} onChange={(event) => setRepeatEnabled(event.target.checked)} className="h-4 w-4 accent-deep-teal" />
                <Repeat2 className="h-4 w-4 text-deep-teal" />
                Repetir este evento
              </label>
              {repeatEnabled && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-semibold text-slate-ink">Frequência
                  <select value={repeatFrequency} onChange={(event) => setRepeatFrequency(event.target.value as typeof repeatFrequency)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                    <option value="daily">Diária</option>
                    <option value="weekly">Semanal</option>
                    <option value="biweekly">Quinzenal · a cada 2 semanas</option>
                    <option value="monthly">A cada 4 semanas</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-ink">A cada
                  {repeatFrequency === "biweekly"
                    ? <span className="mt-1.5 flex min-h-10 items-center rounded-lg border border-mist bg-pearl px-3 text-sm font-normal text-stone">2 semanas</span>
                    : <span className="mt-1.5 flex items-center gap-2">
                        <input type="number" min={1} max={30} value={repeatInterval} onChange={(event) => setRepeatInterval(Number(event.target.value))} className="min-w-0 flex-1 rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
                        <span className="text-xs font-normal text-stone">{repeatFrequency === "daily" ? "dia(s)" : repeatFrequency === "weekly" ? "semana(s)" : "período(s) de 4 semanas"}</span>
                      </span>}
                </label>
                <label className="text-xs font-semibold text-slate-ink">Termina por
                  <select value={repeatEndMode} onChange={(event) => setRepeatEndMode(event.target.value as typeof repeatEndMode)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal">
                    <option value="count">Quantidade</option>
                    <option value="until">Data final</option>
                  </select>
                </label>
                {repeatEndMode === "count" ? <label className="text-xs font-semibold text-slate-ink">Ocorrências
                  <input type="number" min={2} max={366} value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
                </label> : <label className="text-xs font-semibold text-slate-ink">Última ocorrência
                  <input type="date" min={date} value={repeatUntilDate} onChange={(event) => setRepeatUntilDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2.5 text-sm font-normal" />
                </label>}
              </div>}
              {repeatEnabled && <p className="mt-3 text-xs leading-5 text-stone">Todos os horários da série serão validados individualmente contra expediente, permissões, bloqueios e outros eventos antes da criação.</p>}
            </section>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-ink">
              <input type="checkbox" checked={allowOutsideAvailability} onChange={(event) => setAllowOutsideAvailability(event.target.checked)} className="h-4 w-4 accent-deep-teal" />
              Permitir fora do expediente/permissões
            </label>
            {date && <button type="button" onClick={() => void loadSuggestions()} disabled={suggestionsLoading} className="rounded-md border border-deep-teal/30 px-3 py-2 text-xs font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:opacity-40">{suggestionsLoading ? "Buscando encaixes..." : "Atualizar encaixes"}</button>}
          </div>
          {suggestionsLoaded && suggestedSlots.length === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">{allowOutsideAvailability
              ? "Não há espaço livre no dia sem sobrepor outro evento."
              : `Nenhum bloco livre foi encontrado considerando expediente, permissões e antecedência mínima de ${settings.minimumNoticeHours} h. Use o override para ignorar essas regras.`}</p>
          )}
          {suggestedSlots.length > 0 && (
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
            <button type="button" onClick={saveAppointment} disabled={busy || !eventType || !date || !time || (eventType === "custom" && (!customTitle.trim() || !customResourceId || customDurationMinutes < 5)) || (!editingAppointmentId && repeatEnabled && (repeatInterval < 1 || (repeatEndMode === "count" ? repeatCount < 2 : !repeatUntilDate)))} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-40">{busy ? "Salvando..." : editingAppointmentId ? "Salvar alterações" : repeatEnabled ? "Criar série" : "Criar evento"}</button>
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

      {pendingSeriesAction && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-ink/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingSeriesAction(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="series-action-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-deep-teal">Evento recorrente</p>
                <h2 id="series-action-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">
                  {pendingSeriesAction.mode === "delete" ? "O que deseja excluir?" : "O que deseja cancelar?"}
                </h2>
              </div>
              <button type="button" onClick={() => setPendingSeriesAction(null)} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-soft-ivory" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone">
              Ocorrências anteriores não serão alteradas.
              {pendingSeriesAction.mode === "delete" && " A exclusão é permanente e não pode ser desfeita."}
            </p>
            <div className="mt-6 grid gap-2">
              <button type="button" disabled={busy} onClick={() => void changeAppointmentState(pendingSeriesAction.appointment, "occurrence", pendingSeriesAction.mode === "delete")} className="rounded-lg border border-mist px-4 py-3 text-left text-sm font-semibold text-slate-ink hover:border-deep-teal/40 disabled:opacity-50">Somente esta ocorrência</button>
              <button type="button" disabled={busy} onClick={() => void changeAppointmentState(pendingSeriesAction.appointment, "series", pendingSeriesAction.mode === "delete")} className={`rounded-lg px-4 py-3 text-left text-sm font-semibold text-white disabled:opacity-50 ${pendingSeriesAction.mode === "delete" ? "bg-burnt-coral hover:bg-burnt-coral/90" : "bg-deep-teal hover:bg-forest-teal"}`}>Esta e as próximas ocorrências</button>
              <button type="button" onClick={() => setPendingSeriesAction(null)} className="mt-1 rounded-lg px-4 py-2 text-sm font-semibold text-stone hover:bg-soft-ivory">Voltar sem alterar</button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <p className={`text-sm ${feedback.includes("não") || feedback.includes("Falha") ? "text-burnt-coral" : "text-deep-teal"}`} aria-live="polite">{feedback}</p>
    </div>
  );
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function buildWhatsAppUrl(appointment: Appointment, settings: Settings, phone: string) {
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
  return `https://web.whatsapp.com/send?phone=${phone.replace(/\D/g, "")}&text=${encodeURIComponent(message)}`;
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

const defaultResourceIds = new Set(["doctor", "technician"]);