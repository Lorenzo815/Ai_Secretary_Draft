import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { ObjectId } from "mongodb";
import {
  CALENDAR_STATUS_LABELS,
  type CalendarForwardingEndpoint, type CalendarForwardingStatus, type CalendarForwardingTrigger,
} from "./forwarding-contracts";

/** The appointment fields calendar forwarding reads and sends (a subset of the calendar's AppointmentDocument). */
export interface ForwardedAppointment {
  _id: ObjectId;
  status: "held" | "scheduled" | "cancelled" | "completed";
  confirmationStatus?: string;
  eventType: string;
  customTitle?: string | null;
  providerId: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  durationMinutes?: number;
  source?: string;
  notes?: string;
  customerId?: ObjectId | null;
  customerName: string;
  contactPhone: string;
  recurrence?: { seriesId: ObjectId; frequency: string; interval: number; occurrenceIndex: number; totalOccurrences: number } | null;
  paymentRequestId?: ObjectId | null;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What forwarding remembers about an appointment, to tell what changed since it last looked. */
export interface ForwardingSnapshot {
  status: ForwardedAppointment["status"];
  confirmationStatus: CalendarForwardingStatus;
  startAt: Date;
}

/** A change to forward. Stored in the delivery; the payload is built from it when sending. */
export interface CalendarDeliveryEvent {
  eventId: string;
  triggers: CalendarForwardingTrigger[];
  occurredAt: Date;
  /** The appointment was removed from the calendar (not only cancelled). */
  deleted: boolean;
  appointment: ForwardedAppointment;
  previous: ForwardingSnapshot | null;
}

/** Patient data sent with the event: the CRM profile. The CPF is never sent. */
export interface ForwardedCustomer {
  _id: ObjectId;
  name: string;
  phones: string[];
  profile?: {
    fullName?: string;
    birthDate?: string;
    address?: Record<string, unknown>;
    profession?: string;
  };
  relationship?: { status: string };
  serviceStatus?: string;
  firstInteractionAt?: Date;
  lastInteractionAt?: Date;
  createdAt?: Date;
}

export interface CalendarPayloadContext {
  company: { id: string; name: string };
  eventTypes: Array<{ key: string; name: string }>;
  resources: Array<{ id: string; name: string }>;
  customer: ForwardedCustomer | null;
  test?: boolean;
}

const DAY_MS = 24 * 60 * 60_000;

/** Staff bookings without a status are "A confirmar", like on the calendar. */
export function effectiveConfirmationStatus(appointment: Pick<ForwardedAppointment, "confirmationStatus">): CalendarForwardingStatus {
  return appointment.confirmationStatus === "confirmed" || appointment.confirmationStatus === "unconfirmed"
    ? appointment.confirmationStatus
    : "pending";
}

export function snapshotOf(appointment: ForwardedAppointment): ForwardingSnapshot {
  return { status: appointment.status, confirmationStatus: effectiveConfirmationStatus(appointment), startAt: appointment.startAt };
}

export function sameSnapshot(first: ForwardingSnapshot, second: ForwardingSnapshot) {
  return first.status === second.status && first.confirmationStatus === second.confirmationStatus
    && first.startAt.getTime() === second.startAt.getTime();
}

/**
 * What happened to an appointment since `previous`. Temporary holds are never forwarded; a hold that becomes a
 * booking (deposit paid) is "created". Without a previous snapshot, only bookings registered after forwarding was
 * turned on (or future ones it never saw) count as created, so turning it on doesn't replay the whole calendar.
 */
export function detectCalendarTriggers(
  appointment: ForwardedAppointment,
  previous: ForwardingSnapshot | null,
  context: { baselineAt: Date; now: Date },
): CalendarForwardingTrigger[] {
  if (appointment.status === "held") return [];
  if (!previous) {
    if (appointment.status !== "scheduled") return [];
    const registeredAfterBaseline = appointment.createdAt >= context.baselineAt;
    const upcoming = appointment.startAt.getTime() >= context.now.getTime() - DAY_MS;
    return registeredAfterBaseline || upcoming ? ["created"] : [];
  }
  const wasBooked = previous.status === "scheduled";
  if (appointment.status !== "scheduled") return wasBooked && appointment.status === "cancelled" ? ["cancelled"] : [];
  if (!wasBooked) return ["created"];
  const triggers: CalendarForwardingTrigger[] = [];
  if (appointment.startAt.getTime() !== previous.startAt.getTime()) triggers.push("rescheduled");
  if (effectiveConfirmationStatus(appointment) !== previous.confirmationStatus) triggers.push("status_changed");
  return triggers;
}

/** An enabled destination receives an event when it listens to one of its triggers, its status and its event type. */
export function endpointAccepts(endpoint: CalendarForwardingEndpoint, event: Pick<CalendarDeliveryEvent, "triggers" | "appointment">) {
  return endpoint.enabled
    && event.triggers.some((trigger) => endpoint.triggers.includes(trigger))
    && endpoint.statuses.includes(effectiveConfirmationStatus(event.appointment))
    && endpoint.eventTypes.includes(event.appointment.eventType);
}

/** Same change, same ID: rescanning never queues a second delivery for it. */
export function calendarEventId(appointment: ForwardedAppointment, triggers: CalendarForwardingTrigger[], deleted: boolean) {
  return createHash("sha256").update(JSON.stringify([
    appointment._id.toHexString(), triggers, appointment.updatedAt.getTime(), appointment.status,
    effectiveConfirmationStatus(appointment), appointment.startAt.getTime(), deleted,
  ])).digest("hex");
}

/** Keeps only the fields forwarding uses, so internal fields (holds, scheduling options) never leave the platform. */
export function pickForwardedAppointment(document: ForwardedAppointment): ForwardedAppointment {
  return {
    _id: document._id,
    status: document.status,
    ...(document.confirmationStatus ? { confirmationStatus: document.confirmationStatus } : {}),
    eventType: document.eventType,
    customTitle: document.customTitle ?? null,
    providerId: document.providerId,
    startAt: document.startAt,
    endAt: document.endAt,
    timezone: document.timezone,
    ...(document.durationMinutes !== undefined ? { durationMinutes: document.durationMinutes } : {}),
    ...(document.source ? { source: document.source } : {}),
    ...(document.notes ? { notes: document.notes } : {}),
    customerId: document.customerId ?? null,
    customerName: document.customerName ?? "",
    contactPhone: document.contactPhone ?? "",
    recurrence: document.recurrence ? {
      seriesId: document.recurrence.seriesId,
      frequency: document.recurrence.frequency,
      interval: document.recurrence.interval,
      occurrenceIndex: document.recurrence.occurrenceIndex,
      totalOccurrences: document.recurrence.totalOccurrences,
    } : null,
    paymentRequestId: document.paymentRequestId ?? null,
    paidAt: document.paidAt ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function calendarDeliveryEvent(
  document: ForwardedAppointment,
  triggers: CalendarForwardingTrigger[],
  previous: ForwardingSnapshot | null,
  options: { deleted?: boolean; occurredAt?: Date } = {},
): CalendarDeliveryEvent {
  const appointment = pickForwardedAppointment(document);
  const deleted = options.deleted ?? false;
  return {
    eventId: calendarEventId(appointment, triggers, deleted),
    triggers,
    occurredAt: options.occurredAt ?? appointment.updatedAt,
    deleted,
    appointment,
    previous,
  };
}

const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

/** The JSON sent to the destination. */
export function buildCalendarPayload(event: CalendarDeliveryEvent, context: CalendarPayloadContext) {
  const { appointment } = event;
  const status = effectiveConfirmationStatus(appointment);
  const eventTypeName = context.eventTypes.find((item) => item.key === appointment.eventType)?.name ?? appointment.eventType;
  const local = (value: Date) => DateTime.fromJSDate(value).setZone(appointment.timezone);
  const customer = context.customer;
  return {
    object: "oria.calendar_event",
    eventId: event.eventId,
    test: context.test === true,
    triggers: event.triggers,
    occurredAt: event.occurredAt.toISOString(),
    company: context.company,
    appointment: {
      id: appointment._id.toHexString(),
      status: appointment.status,
      deleted: event.deleted,
      confirmationStatus: status,
      confirmationStatusLabel: CALENDAR_STATUS_LABELS[status],
      eventType: { key: appointment.eventType, name: eventTypeName },
      title: appointment.customTitle || eventTypeName,
      resource: {
        id: appointment.providerId,
        name: context.resources.find((resource) => resource.id === appointment.providerId)?.name ?? null,
      },
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      timezone: appointment.timezone,
      localDate: local(appointment.startAt).toISODate(),
      localStartTime: local(appointment.startAt).toFormat("HH:mm"),
      localEndTime: local(appointment.endAt).toFormat("HH:mm"),
      durationMinutes: appointment.durationMinutes ?? Math.round((appointment.endAt.getTime() - appointment.startAt.getTime()) / 60_000),
      source: appointment.source ?? null,
      notes: appointment.notes ?? null,
      recurrence: appointment.recurrence ? {
        seriesId: appointment.recurrence.seriesId.toHexString(),
        frequency: appointment.recurrence.frequency,
        interval: appointment.recurrence.interval,
        occurrenceIndex: appointment.recurrence.occurrenceIndex,
        totalOccurrences: appointment.recurrence.totalOccurrences,
      } : null,
      payment: appointment.paymentRequestId ? {
        paymentRequestId: appointment.paymentRequestId.toHexString(),
        paidAt: iso(appointment.paidAt),
      } : null,
      createdAt: appointment.createdAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
    },
    previous: event.previous ? {
      status: event.previous.status,
      confirmationStatus: event.previous.confirmationStatus,
      startAt: event.previous.startAt.toISOString(),
    } : null,
    customer: customer ? {
      id: customer._id.toHexString(),
      name: customer.name,
      fullName: customer.profile?.fullName ?? null,
      phones: customer.phones,
      birthDate: customer.profile?.birthDate ?? null,
      address: customer.profile?.address ?? null,
      profession: customer.profile?.profession ?? null,
      relationshipStatus: customer.relationship?.status ?? null,
      serviceStatus: customer.serviceStatus ?? null,
      firstInteractionAt: iso(customer.firstInteractionAt),
      lastInteractionAt: iso(customer.lastInteractionAt),
      createdAt: iso(customer.createdAt),
    } : null,
    contact: { name: appointment.customerName, phone: appointment.contactPhone },
  };
}
