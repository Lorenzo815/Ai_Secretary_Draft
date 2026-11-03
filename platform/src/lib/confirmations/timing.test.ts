import { describe, expect, it } from "vitest";
import {
  confirmationStatusAfterPayment, eligibleForReminders, nextReminderAt, plannedFirstSend, replyDeadline, windowStartAtOrAfter,
} from "./timing";
import {
  confirmationPayload, parseConfirmationPayload, renderConfirmationBody, templateParameter, validateConfirmationTemplateBody,
  DEFAULT_CONFIRMATION_TEMPLATE,
} from "./template-content";

// São Paulo is UTC-3: 10:00 local = 13:00Z.
const policy = { firstSendHoursBefore: 24, activeStartHour: 8, activeEndHour: 20, intervalMinutes: 120, timezone: "America/Sao_Paulo" };
const at = (iso: string) => new Date(iso);

describe("confirmation timing", () => {
  it("keeps a moment inside the window and moves one outside it to the next window start", () => {
    expect(windowStartAtOrAfter(at("2026-11-05T13:00:00Z"), policy)).toEqual(at("2026-11-05T13:00:00Z"));
    expect(windowStartAtOrAfter(at("2026-11-05T09:00:00Z"), policy)).toEqual(at("2026-11-05T11:00:00Z")); // 06:00 → 08:00
    expect(windowStartAtOrAfter(at("2026-11-05T23:30:00Z"), policy)).toEqual(at("2026-11-06T11:00:00Z")); // 20:30 → 08:00 next day
  });

  it("plans the first reminder 24 h before the first event, later into the window when needed", () => {
    expect(plannedFirstSend(at("2026-11-06T13:00:00Z"), policy)).toEqual(at("2026-11-05T13:00:00Z")); // Fri 10:00 → Thu 10:00
    expect(plannedFirstSend(at("2026-11-06T10:00:00Z"), policy)).toEqual(at("2026-11-05T11:00:00Z")); // Fri 07:00 → Thu 08:00
  });

  it("spaces reminders 2 h apart inside the window and never after the event starts", () => {
    const event = at("2026-11-06T13:00:00Z");
    expect(nextReminderAt(at("2026-11-05T13:00:00Z"), event, policy)).toEqual(at("2026-11-05T15:00:00Z"));
    expect(nextReminderAt(at("2026-11-05T22:00:00Z"), event, policy)).toEqual(at("2026-11-06T11:00:00Z")); // 19:00 + 2 h → Fri 08:00
    expect(nextReminderAt(at("2026-11-06T11:30:00Z"), event, policy)).toBeNull(); // 08:30 + 2 h = 10:30, after the event
  });

  it("gives one interval to answer after the last reminder, capped at the event start", () => {
    expect(replyDeadline(at("2026-11-05T17:00:00Z"), at("2026-11-06T13:00:00Z"), policy)).toEqual(at("2026-11-05T19:00:00Z"));
    expect(replyDeadline(at("2026-11-06T12:00:00Z"), at("2026-11-06T13:00:00Z"), policy)).toEqual(at("2026-11-06T13:00:00Z"));
  });

  it("confirms paid bookings directly when no reminder process applies or the event is already within the period", () => {
    const task = { enabled: true, firstSendHoursBefore: 24 };
    const now = at("2026-11-05T18:00:00Z");
    expect(confirmationStatusAfterPayment({ firstStartAt: at("2026-11-06T13:00:00Z"), now, task })).toBe("confirmed");
    expect(confirmationStatusAfterPayment({ firstStartAt: at("2026-11-06T21:00:00Z"), now, task })).toBe("pending"); // 27 h ahead
    expect(confirmationStatusAfterPayment({ firstStartAt: at("2026-11-20T13:00:00Z"), now, task: { ...task, enabled: false } })).toBe("confirmed");
  });

  it("skips recent bookings, except paid ones", () => {
    const firstSend = at("2026-11-05T21:00:00Z");
    expect(eligibleForReminders({ createdAt: at("2026-11-05T18:00:00Z") }, firstSend, 12)).toBe(false);
    expect(eligibleForReminders({ createdAt: at("2026-11-05T18:00:00Z"), paymentRequestId: "paid" }, firstSend, 12)).toBe(true);
    expect(eligibleForReminders({ createdAt: at("2026-11-05T09:00:00Z") }, firstSend, 12)).toBe(true);
    expect(eligibleForReminders({ createdAt: at("2026-11-05T20:59:00Z") }, firstSend, 0)).toBe(true);
  });
});

describe("confirmation template", () => {
  it("accepts the default text and requires the three variables once each, not at the edges", () => {
    expect(validateConfirmationTemplateBody(DEFAULT_CONFIRMATION_TEMPLATE.body)).toBe(DEFAULT_CONFIRMATION_TEMPLATE.body);
    expect(() => validateConfirmationTemplateBody("Olá {{1}}, sua consulta é {{2}}.")).toThrow("{{3}}");
    expect(() => validateConfirmationTemplateBody("{{1}}, confirme {{2}} às {{3}} por favor")).toThrow(/início ou no fim/);
    expect(() => validateConfirmationTemplateBody("Olá {{1}}, {{2}} {{3}} e {{3}} ok")).toThrow();
  });

  it("round-trips button payloads and ignores other buttons", () => {
    const id = "6ae96860755f1d727b495812";
    expect(parseConfirmationPayload(confirmationPayload(id, "reschedule"))).toEqual({ confirmationId: id, action: "reschedule" });
    expect(parseConfirmationPayload("Confirmar presença")).toBeNull();
    expect(parseConfirmationPayload(`oria_cc:${id}:delete`)).toBeNull();
  });

  it("renders the body for the conversation history and sanitizes parameters for Meta", () => {
    expect(renderConfirmationBody("Olá, {{1}}! {{2}}: {{3}}.", ["Ana", "sexta", "10:00 Consulta"])).toBe("Olá, Ana! sexta: 10:00 Consulta.");
    expect(templateParameter("a\nb\t c     d")).toBe("a b c d");
  });
});
