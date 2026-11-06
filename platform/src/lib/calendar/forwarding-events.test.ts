import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CalendarForwardingEndpoint } from "./forwarding-contracts";
import {
  buildCalendarPayload, calendarDeliveryEvent, detectCalendarTriggers, endpointAccepts, snapshotOf,
  type ForwardedAppointment,
} from "./forwarding-events";

const baselineAt = new Date("2026-11-06T12:00:00Z");
const now = new Date("2026-11-06T13:00:00Z");
const context = { baselineAt, now };
const appointment = (patch: Partial<ForwardedAppointment> = {}): ForwardedAppointment => ({
  _id: new ObjectId("6aeb29e7b277313e145d37d4"), status: "scheduled", confirmationStatus: "pending", eventType: "consultation",
  providerId: "doctor", startAt: new Date("2026-11-10T13:00:00Z"), endAt: new Date("2026-11-10T13:30:00Z"),
  timezone: "America/Sao_Paulo", durationMinutes: 30, source: "assistant", customerId: new ObjectId("6abbbd640d62d8e984cae18c"),
  customerName: "Ana Souza", contactPhone: "5511999990000", createdAt: new Date("2026-11-06T12:30:00Z"),
  updatedAt: new Date("2026-11-06T12:30:00Z"), ...patch,
});
const endpoint: CalendarForwardingEndpoint = {
  id: "11111111-1111-4111-8111-111111111111", name: "CRM", url: "https://crm.example/hook", enabled: true, maxRetries: 3,
  triggers: ["created", "status_changed"], statuses: ["pending", "confirmed"], eventTypes: ["consultation"],
};

describe("calendar change detection", () => {
  it("forwards a booking registered after activation, by the AI or by staff, but never a temporary hold", () => {
    expect(detectCalendarTriggers(appointment(), null, context)).toEqual(["created"]);
    expect(detectCalendarTriggers(appointment({ source: "manual", confirmationStatus: undefined }), null, context)).toEqual(["created"]);
    expect(detectCalendarTriggers(appointment({ status: "held" }), null, context)).toEqual([]);
  });

  it("treats a hold confirmed by a deposit, or a reactivated booking, as created", () => {
    expect(detectCalendarTriggers(appointment(), { ...snapshotOf(appointment()), status: "cancelled" }, context)).toEqual(["created"]);
    const heldBefore = appointment({ createdAt: new Date("2026-11-06T11:00:00Z") });
    expect(detectCalendarTriggers(heldBefore, null, context)).toEqual(["created"]);
  });

  it("does not replay old bookings it never saw, nor cancellations of holds", () => {
    const old = appointment({ createdAt: new Date("2026-09-01T12:00:00Z"), startAt: new Date("2026-10-01T13:00:00Z") });
    expect(detectCalendarTriggers(old, null, context)).toEqual([]);
    expect(detectCalendarTriggers(appointment({ status: "cancelled" }), null, context)).toEqual([]);
  });

  it("reports confirmation, time and cancellation changes against the last snapshot", () => {
    const previous = snapshotOf(appointment());
    expect(detectCalendarTriggers(appointment({ confirmationStatus: "confirmed" }), previous, context)).toEqual(["status_changed"]);
    expect(detectCalendarTriggers(appointment({ startAt: new Date("2026-11-11T13:00:00Z") }), previous, context)).toEqual(["rescheduled"]);
    expect(detectCalendarTriggers(appointment({ startAt: new Date("2026-11-11T13:00:00Z"), confirmationStatus: "unconfirmed" }), previous, context))
      .toEqual(["rescheduled", "status_changed"]);
    expect(detectCalendarTriggers(appointment({ status: "cancelled" }), previous, context)).toEqual(["cancelled"]);
    expect(detectCalendarTriggers(appointment({ notes: "only notes changed" }), previous, context)).toEqual([]);
  });
});

describe("destination filters", () => {
  const event = (patch: Partial<ForwardedAppointment>, triggers = ["created" as const]) => calendarDeliveryEvent(appointment(patch), [...triggers], null);

  it("needs a listened moment, confirmation status and event type, on an enabled destination", () => {
    expect(endpointAccepts(endpoint, event({}))).toBe(true);
    expect(endpointAccepts(endpoint, event({ confirmationStatus: "unconfirmed" }))).toBe(false);
    expect(endpointAccepts(endpoint, event({ eventType: "bioimpedance" }))).toBe(false);
    expect(endpointAccepts(endpoint, calendarDeliveryEvent(appointment(), ["rescheduled"], null))).toBe(false);
    expect(endpointAccepts({ ...endpoint, enabled: false }, event({}))).toBe(false);
  });

  it("gives the same change the same ID and a different change a new one", () => {
    expect(event({}).eventId).toBe(event({}).eventId);
    expect(event({}).eventId).not.toBe(event({ confirmationStatus: "confirmed" }).eventId);
    expect(calendarDeliveryEvent(appointment(), ["cancelled"], null, { deleted: true }).eventId)
      .not.toBe(calendarDeliveryEvent(appointment(), ["cancelled"], null).eventId);
  });
});

describe("calendar payload", () => {
  it("sends the event with local date and time, its type name and the patient's CRM profile", () => {
    const source = { ...appointment({ notes: "Trazer exames" }), holdExpiresAt: new Date(), schedulingOptionId: new ObjectId() };
    const event = calendarDeliveryEvent(source, ["created"], null);
    const payload = buildCalendarPayload(event, {
      company: { id: "9b9d1f4b4f16cf6e84abcce4", name: "Clínica" },
      eventTypes: [{ key: "consultation", name: "Consulta" }],
      resources: [{ id: "doctor", name: "Dr. Matheus" }],
      customer: {
        _id: new ObjectId("6abbbd640d62d8e984cae18c"), name: "Ana", phones: ["5511999990000"],
        profile: { fullName: "Ana Souza", birthDate: "1990-02-03", profession: "Engenheira", address: { city: "Curitiba" } },
        cpf: "12345678909", relationship: { status: "new" }, serviceStatus: "ai_active",
      },
    });
    expect(event.appointment).not.toHaveProperty("holdExpiresAt");
    expect(event.appointment).not.toHaveProperty("schedulingOptionId");
    expect(payload).toMatchObject({
      object: "oria.calendar_event", test: false, triggers: ["created"],
      appointment: {
        id: "6aeb29e7b277313e145d37d4", status: "scheduled", deleted: false,
        confirmationStatus: "pending", confirmationStatusLabel: "A confirmar",
        eventType: { key: "consultation", name: "Consulta" }, title: "Consulta",
        resource: { id: "doctor", name: "Dr. Matheus" },
        startAt: "2026-11-10T13:00:00.000Z", localDate: "2026-11-10", localStartTime: "10:00", localEndTime: "10:30",
        source: "assistant", notes: "Trazer exames", recurrence: null, payment: null,
      },
      previous: null,
      customer: {
        id: "6abbbd640d62d8e984cae18c", fullName: "Ana Souza", cpf: "12345678909", birthDate: "1990-02-03",
        address: { city: "Curitiba" }, profession: "Engenheira", relationshipStatus: "new",
      },
      contact: { name: "Ana Souza", phone: "5511999990000" },
    });
    expect(payload.customer).not.toHaveProperty("leadQualification");
  });

  it("sends staff bookings without a patient with only the contact on the event", () => {
    const event = calendarDeliveryEvent(appointment({ customerId: null, customerName: "", contactPhone: "" }), ["created"], null);
    const payload = buildCalendarPayload(event, { company: { id: "x", name: "y" }, eventTypes: [], resources: [], customer: null });
    expect(payload.customer).toBeNull();
    expect(payload.appointment.eventType).toEqual({ key: "consultation", name: "consultation" });
  });
});
