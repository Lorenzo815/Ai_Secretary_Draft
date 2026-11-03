import "server-only";

import { DateTime } from "luxon";
import { applyConfirmationAnswer } from "../../confirmations/service";
import type { ConfirmationAction } from "../../confirmations/template-content";
import type { ToolExecution, ToolExecutionContext } from "./contracts";

const TOOL = "calendar.confirm_attendance";
const ACTIONS: ConfirmationAction[] = ["confirm", "reschedule", "cancel"];

export async function executeConfirmAttendanceTool(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolExecution> {
  const action = args.action as ConfirmationAction;
  if (!ACTIONS.includes(action) || args.confirmedByCustomer !== true) {
    return error("arguments", "invalid_arguments", "Informe action (confirm, reschedule ou cancel) e confirmedByCustomer=true após uma resposta clara do paciente.");
  }
  if (context.isMutationAllowed && !(await context.isMutationAllowed())) {
    return error("job", "stale_job", "Uma mensagem mais recente chegou antes da alteração. Nada foi registrado.");
  }
  try {
    const outcome = await applyConfirmationAnswer({ customerId: context.customerId, action, source: "assistant" });
    if (outcome.kind === "not_found") return error("confirmation", "not_found", "Não há confirmação de consulta pendente para este paciente.");
    if (outcome.kind === "late") {
      return error("confirmation", "late_answer", "O prazo da confirmação terminou: a equipe decide. Diga que a clínica vai verificar o horário e use human_handoff.");
    }
    return {
      output: JSON.stringify({
        ok: true,
        tool: TOOL,
        status: outcome.kind,
        appointments: outcome.appointments.map((appointment) => {
          const local = DateTime.fromJSDate(appointment.startAt).setZone(appointment.timezone);
          return { eventType: appointment.eventType, startAt: appointment.startAt.toISOString(), localDate: local.toISODate(), localTime: local.toFormat("HH:mm") };
        }),
        ...(outcome.kind === "cancel_requested" ? { next: "Diga que a equipe vai entrar em contato para concluir o cancelamento e use human_handoff." } : {}),
        ...(outcome.kind === "reschedule_requested" ? { next: "Busque novos horários com calendar.find_slots (purpose=reschedule)." } : {}),
      }),
      retryable: false,
    };
  } catch (failure) {
    return {
      output: JSON.stringify({ ok: false, type: "operational_error", message: failure instanceof Error ? failure.message : "Falha ao registrar a resposta." }),
      retryable: false,
    };
  }
}

function error(field: string, code: string, message: string): ToolExecution {
  return { output: JSON.stringify({ ok: false, type: "validation_error", errors: [{ field, code, message }] }), retryable: true };
}
