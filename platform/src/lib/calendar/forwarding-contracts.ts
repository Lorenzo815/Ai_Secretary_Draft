import type { ForwardingEndpoint, ForwardingStats } from "../whatsapp/forwarding-contracts";

export const CALENDAR_FORWARDING_TRIGGERS = ["created", "status_changed", "rescheduled", "cancelled"] as const;
export type CalendarForwardingTrigger = typeof CALENDAR_FORWARDING_TRIGGERS[number];

export const CALENDAR_FORWARDING_STATUSES = ["pending", "confirmed", "unconfirmed"] as const;
export type CalendarForwardingStatus = typeof CALENDAR_FORWARDING_STATUSES[number];

export const CALENDAR_TRIGGER_LABELS: Record<CalendarForwardingTrigger, string> = {
  created: "Evento criado",
  status_changed: "Status de confirmação alterado",
  rescheduled: "Data ou horário alterado",
  cancelled: "Evento cancelado ou excluído",
};

export const CALENDAR_STATUS_LABELS: Record<CalendarForwardingStatus, string> = {
  pending: "A confirmar",
  confirmed: "Confirmado",
  unconfirmed: "Sem confirmação",
};

export const CALENDAR_DEFAULT_TRIGGERS: CalendarForwardingTrigger[] = ["created", "status_changed"];
export const CALENDAR_DEFAULT_STATUSES: CalendarForwardingStatus[] = ["pending", "confirmed"];

/** A destination for calendar events, with the filters that decide which events it receives. */
export interface CalendarForwardingEndpoint extends ForwardingEndpoint {
  triggers: CalendarForwardingTrigger[];
  statuses: CalendarForwardingStatus[];
  /** Keys of the clinic's event types (Agenda › Tipos de evento). */
  eventTypes: string[];
}

export interface CalendarForwardingSettings {
  revision: number;
  endpoints: CalendarForwardingEndpoint[];
  eventTypes: Array<{ key: string; name: string }>;
  stats: ForwardingStats;
}
