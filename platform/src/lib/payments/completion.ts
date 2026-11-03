import "server-only";

import { DateTime } from "luxon";
import { emitAutomationEvent } from "../automation";
import { getCalendarSettings } from "../calendar/calendar";
import { applyAttendanceAfterPayment } from "../confirmations/service";
import { confirmHeldSchedulingPlanOptions, releaseHeldSchedulingPlanOptions } from "../calendar/plans";
import { updateCustomerServiceStatus } from "../crm";
import { saveWhatsAppMessage, sendTextMessage } from "../whatsapp";
import { setPaymentAppointments, type PaymentRequestDocument } from "./payments";

export async function completePaymentTransition(
  payment: PaymentRequestDocument,
  status: "paid" | "rejected",
) {
  await emitAutomationEvent({
    type: "payment.status.changed",
    customerId: payment.customerId,
    occurredAt: new Date(),
    payload: { status, provider: payment.provider ?? "manual" },
  });
  if (status === "rejected") {
    await releaseHeldSchedulingPlanOptions(payment.customerId, payment.schedulingOptionId);
    await updateCustomerServiceStatus(payment.customerId, "human_active");
    return {};
  }

  const confirmedAppointments = await confirmHeldSchedulingPlanOptions(payment.customerId, {
    paymentRequestId: payment._id,
    appointmentIds: payment.appointmentIds,
    paidAt: payment.paidAt,
  });
  // Records what the deposit actually covers. Without an active hold it stays unallocated and can
  // confirm the patient's next booking or be linked by staff in Financeiro.
  await setPaymentAppointments(payment._id, confirmedAppointments.map((appointment) => appointment._id));
  const attendance = await applyAttendanceAfterPayment({ customerId: payment.customerId, appointments: confirmedAppointments });
  const customer = await updateCustomerServiceStatus(payment.customerId, "ai_active");
  const contactPhone = customer.phones[0];
  if (!contactPhone) return {};
  const paymentConfirmation = payment.provider === "mercado_pago"
    ? "Sinal confirmado pelo Mercado Pago."
    : "Sinal confirmado pela equipe.";
  const body = confirmedAppointments.length > 0 && attendance === "confirmed"
    ? `${paymentConfirmation} ${await confirmedTimes(confirmedAppointments)} Te esperamos!`
    : confirmedAppointments.length > 0
    ? `${paymentConfirmation} ${confirmedAppointments.length === 1
      ? "Seu horário está agendado; vamos confirmar sua presença mais perto da data."
      : "Seus horários estão agendados; vamos confirmar sua presença mais perto da data."}`
    : `${paymentConfirmation} Como não havia mais uma reserva temporária ativa, nenhum horário foi confirmado automaticamente. Vamos escolher uma nova opção para concluir seu agendamento. Para quando você prefere?`;
  try {
    const sent = await sendTextMessage({ to: contactPhone, body });
    await saveWhatsAppMessage({
      customerId: payment.customerId,
      metaMessageId: sent.messageId,
      contactPhone,
      contactName: customer.name,
      direction: "outbound",
      type: "text",
      body,
      status: "sent",
      timestamp: new Date(),
    });
    return {};
  } catch (error) {
    return { deliveryWarning: error instanceof Error ? error.message : "Não foi possível avisar o cliente." };
  }
}
async function confirmedTimes(appointments: Array<{ startAt: Date; eventType: string; customTitle?: string }>) {
  const settings = await getCalendarSettings();
  const format = (appointment: { startAt: Date }) => {
    const local = DateTime.fromJSDate(appointment.startAt).setZone(settings.timezone).setLocale("pt-BR");
    return `${local.toFormat("cccc, dd/MM")} às ${local.toFormat("HH:mm")}`;
  };
  const sorted = [...appointments].sort((first, second) => first.startAt.getTime() - second.startAt.getTime());
  if (sorted.length === 1) return `Seu horário está confirmado para ${format(sorted[0])}.`;
  const name = (appointment: { eventType: string; customTitle?: string }) => appointment.customTitle
    || settings.eventTypes.find((eventType) => eventType.key === appointment.eventType)?.name || appointment.eventType;
  return `Seus horários estão confirmados: ${sorted.map((appointment) => `${name(appointment)} ${format(appointment)}`).join("; ")}.`;
}
