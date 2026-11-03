import type { ToolDefinition } from "./contracts";

// Only offered to the AI while the patient has an open appointment confirmation (see orchestrator).
export const APPOINTMENT_CONFIRMATION_TOOL = "calendar.confirm_attendance";

export const confirmationToolDefinitions = {
  [APPOINTMENT_CONFIRMATION_TOOL]: {
    label: "Responder à confirmação de consulta",
    description: "Registra a resposta do paciente ao lembrete de confirmação: confirma a presença, pede um novo horário ou pede o cancelamento à equipe.",
    mutates: true,
    argumentsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "confirmedByCustomer"],
      properties: {
        action: { type: "string", enum: ["confirm", "reschedule", "cancel"] },
        confirmedByCustomer: { type: "boolean" },
      },
    },
    promptInstructions: `calendar.confirm_attendance responde ao lembrete de confirmação descrito em runtime.operations.appointmentConfirmation.
- Use quando o paciente responder por texto ao lembrete: action=confirm ("sim, vou", "confirmado"), action=reschedule (não pode ir e quer outro horário) ou action=cancel (quer desmarcar e não remarcar). Exige confirmedByCustomer=true e uma resposta clara; na dúvida, pergunte.
- confirm: os eventos do dia passam a "Confirmado"; confirme ao paciente o dia e os horários retornados.
- reschedule: os lembretes param e o horário atual continua reservado até o novo ser escolhido. Em seguida, use calendar.find_slots com purpose=reschedule e calendar.reschedule para mover os eventos.
- cancel: você nunca cancela. Diga que a equipe da clínica vai entrar em contato para concluir o cancelamento e use human_handoff.
- Se o resultado indicar late_answer, o prazo da confirmação terminou e a equipe decide: diga que a clínica vai verificar o horário e use human_handoff.`,
    execute: async (context, args) => (await import("./confirmation")).executeConfirmAttendanceTool(context, args),
    getGroundedReply: () => null,
  },
} satisfies Record<string, ToolDefinition>;
