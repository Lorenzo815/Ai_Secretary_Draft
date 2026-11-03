import type { Document, ObjectId } from "mongodb";

// Historical data that can be removed by hand in the back-office (no database access here, so it can be tested).
// Never included: patients, conversations, appointments, payments and the ledger, configuration, audit, and
// anything still pending or in use.

export const CLEANUP_TARGETS = {
  runs_compact: {
    label: "Execuções da IA — compactar",
    collection: "assistant_run_steps",
    action: "compact",
    description: "Remove os passos detalhados (entradas e resultados de ferramentas) de execuções finalizadas. O resumo da execução continua (status, decisão, contagens) e as métricas não mudam.",
  },
  runs_delete: {
    label: "Execuções da IA — excluir",
    collection: "assistant_runs",
    action: "delete",
    description: "Exclui execuções finalizadas e seus passos. Somem do painel do paciente, de Operações e das métricas da Visão geral do período.",
  },
  ai_task_calls: {
    label: "Chamadas de IA (tokens e custo)",
    collection: "ai_task_calls",
    action: "delete",
    description: "Exclui o registro de chamadas aos modelos. Os gráficos de custo e uso perdem esse período (sem totais guardados).",
  },
  lead_qualification_history: {
    label: "Histórico de qualificação de leads",
    collection: "lead_qualification_history",
    action: "delete",
    description: "Exclui qualificações antigas. A mais recente de cada paciente é sempre mantida (é a que aparece no cadastro).",
  },
  whatsapp_coexistence_webhook_events: {
    label: "Eventos brutos do WhatsApp (coexistência)",
    collection: "whatsapp_coexistence_webhook_events",
    action: "delete",
    description: "Exclui eventos já processados. Eventos de mensagens enviadas pelo celular da clínica ainda não sincronizados nunca entram.",
  },
  whatsapp_forwarding_deliveries: {
    label: "Encaminhamentos de webhook",
    collection: "whatsapp_forwarding_deliveries",
    action: "delete",
    description: "Exclui o registro de encaminhamentos concluídos (entregues, falhos ou cancelados). Pendentes nunca entram.",
  },
} as const;

export type CleanupTarget = keyof typeof CLEANUP_TARGETS;

const FINISHED_RUN_STATUSES = ["completed", "failed", "superseded"];
const FINISHED_DELIVERY_STATUSES = ["delivered", "failed", "cancelled"];

/** The documents a target removes: always older than the cutoff, finished, and within the clinic when one is chosen. */
export function cleanupFilter(
  target: Exclude<CleanupTarget, "runs_compact">,
  input: { companyIds: ObjectId[] | null; cutoff: Date; queuedJobIds?: ObjectId[]; keepIds?: ObjectId[] },
): Document {
  // null = every clinic; otherwise only the selected ones.
  const company = input.companyIds ? { companyId: { $in: input.companyIds } } : {};
  switch (target) {
    case "runs_delete":
      // Runs of jobs still in the queue can be resumed from their steps.
      return { ...company, status: { $in: FINISHED_RUN_STATUSES }, startedAt: { $lt: input.cutoff }, jobId: { $nin: input.queuedJobIds ?? [] } };
    case "ai_task_calls":
      return { ...company, startedAt: { $lt: input.cutoff }, status: { $nin: ["running", "pending"] } };
    case "lead_qualification_history":
      return { ...company, generatedAt: { $lt: input.cutoff }, _id: { $nin: input.keepIds ?? [] } };
    case "whatsapp_coexistence_webhook_events":
      // Message echoes are processed by the worker; other event types are only captured.
      return { ...company, receivedAt: { $lt: input.cutoff }, $or: [{ processedAt: { $ne: null } }, { field: { $ne: "smb_message_echoes" } }] };
    case "whatsapp_forwarding_deliveries":
      return { ...company, status: { $in: FINISHED_DELIVERY_STATUSES }, createdAt: { $lt: input.cutoff } };
  }
}
