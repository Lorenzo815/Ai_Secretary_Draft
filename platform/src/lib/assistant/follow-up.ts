import "server-only";

import { DateTime } from "luxon";
import {
  claimDueFollowUpTrigger,
  completeFollowUpTrigger,
  failFollowUpTrigger,
} from "../calendar";
import { assignCustomerFlow } from "./flows";
import { scheduleAssistantResponse } from "./queue";
import { findCustomerById } from "../crm";

export async function processNextFollowUpTrigger(leaseMs: number) {
  const claimed = await claimDueFollowUpTrigger(leaseMs);
  if (!claimed) return { processed: false as const };
  const { trigger, appointment } = claimed;
  try {
    const customer = await findCustomerById(appointment.customerId.toString());
    if (!customer || customer.serviceStatus === "closed" || customer.serviceStatus === "human_active") {
      await completeFollowUpTrigger(trigger._id);
      return { processed: true as const, skipped: "customer_not_available" };
    }
    await assignCustomerFlow(
      appointment.customerId,
      "follow_up",
      "assistant",
      "Lembrete pré-consulta disparado pelo calendário",
      {
        stage: "enviar_lembrete",
        collectedData: [{ key: "appointmentId", value: appointment._id.toString() }],
        missingData: ["customer_confirmation"],
        notes: ["Aguardando o envio do lembrete pré-consulta."],
      },
    );
    const localStart = DateTime.fromJSDate(appointment.startAt)
      .setZone(appointment.timezone)
      .setLocale("pt-BR")
      .toFormat("cccc, dd/LL/yyyy 'às' HH:mm");
    await scheduleAssistantResponse({
      customerId: appointment.customerId,
      latestInboundAt: new Date(),
      followUpTriggerId: trigger._id,
      triggerContext: `Solicite ao cliente a confirmação explícita de presença no atendimento marcado em ${localStart}. Informe a data e o horário sem alterá-los e termine com a pergunta: Você confirma sua presença?`,
      targetContactPhone: appointment.contactPhone,
      targetContactName: appointment.customerName,
      targetMessageSource: appointment.messageSource,
    });
    return { processed: true as const, type: trigger.type };
  } catch (error) {
    await failFollowUpTrigger(trigger._id, trigger.attempts);
    throw error;
  }
}