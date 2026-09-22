import "server-only";

import { emitAutomationEvent } from "../automation";
import { confirmHeldSchedulingPlanOptions, releaseHeldSchedulingPlanOptions } from "../calendar/plans";
import { updateCustomerServiceStatus } from "../crm";
import { saveWhatsAppMessage, sendTextMessage } from "../whatsapp";
import type { PaymentRequestDocument } from "./payments";

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
    await releaseHeldSchedulingPlanOptions(payment.customerId);
    await updateCustomerServiceStatus(payment.customerId, "human_active");
    return {};
  }

  const confirmedAppointments = await confirmHeldSchedulingPlanOptions(payment.customerId);
  const customer = await updateCustomerServiceStatus(payment.customerId, "ai_active");
  const contactPhone = customer.phones[0];
  if (!contactPhone) return {};
  const paymentConfirmation = payment.provider === "mercado_pago"
    ? "Pagamento confirmado pelo Mercado Pago."
    : "Pagamento confirmado pela equipe.";
  const body = confirmedAppointments.length > 0
    ? `${paymentConfirmation} ${confirmedAppointments.length === 1
      ? "A reserva temporária foi confirmada e o horário escolhido está agendado."
      : "A reserva temporária foi confirmada e os horários escolhidos estão agendados."}`
    : `${paymentConfirmation} Como não havia mais uma reserva temporária ativa, nenhum horário foi confirmado automaticamente. Vamos escolher uma nova opção para concluir seu agendamento.`;
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