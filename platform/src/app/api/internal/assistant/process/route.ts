import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { listPausedAgentCompanyIds } from "@/lib/assistant/agent";
import { processNextAutomationJob } from "@/lib/automation";
import { processForwardingDeliveries } from "@/lib/whatsapp/forwarding";
import { processPendingWhatsAppMessageEchoes } from "@/lib/whatsapp/message-echoes";
import { refreshWhatsAppTemplateCatalog } from "@/lib/whatsapp/templates";
import { processAppointmentConfirmations } from "@/lib/confirmations/service";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const [forwarding, result, templates, confirmations] = await Promise.allSettled([
    processForwardingDeliveries(),
    processAssistantBatch(),
    refreshWhatsAppTemplateCatalog(),
    processAppointmentConfirmations(),
  ]);
  // Reminders are retried on the next tick; they never block the rest of the worker.
  if (confirmations.status === "rejected") {
    console.error("Appointment confirmation worker failed.", { errorType: confirmations.reason instanceof Error ? confirmations.reason.name : "Unknown" });
  }
  if (result.status === "rejected") throw result.reason;
  if (forwarding.status === "rejected") {
    console.error("WhatsApp forwarding worker failed.", { errorType: forwarding.reason instanceof Error ? forwarding.reason.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível processar os encaminhamentos." }, { status: 503 });
  }
  if (templates.status === "rejected") {
    console.error("WhatsApp template catalog refresh failed.", { errorType: templates.reason instanceof Error ? templates.reason.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível atualizar o catálogo de modelos do WhatsApp." }, { status: 503 });
  }
  if (result.value.echoSyncFailures > 0) {
    return NextResponse.json({
      ...result.value, forwardingProcessed: forwarding.value,
      error: "Há eventos do WhatsApp pendentes de sincronização. O worker tentará novamente.",
    }, { status: 503 });
  }
  return NextResponse.json({
    ...result.value, forwardingProcessed: forwarding.value, templateCatalog: templates.value,
    confirmations: confirmations.status === "fulfilled" ? confirmations.value : null,
  });
}

async function processAssistantBatch() {
  const synchronization = await processPendingWhatsAppMessageEchoes();
  const echoResults = { echoesProcessed: synchronization.processed, echoSyncFailures: synchronization.failed };
  const batchSize = Math.min(Math.max(Number(process.env.ASSISTANT_WORKER_BATCH_SIZE) || 1, 1), 20);
  // Paused companies keep their jobs queued, so conversations resume when automatic replies are re-enabled.
  const pausedCompanyIds = await listPausedAgentCompanyIds();
  const results = [];
  for (let index = 0; index < batchSize; index += 1) {
    const result = await processNextAutomationJob({ excludeCompanyIds: pausedCompanyIds });
    if (!result.processed) break;
    results.push(result);
  }

  return { processed: results.length, results, pausedCompanies: pausedCompanyIds.length, ...echoResults };
}

function isAuthorized(authorization: string | null) {
  const secret = process.env.ASSISTANT_WORKER_SECRET;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}