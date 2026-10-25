import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAgentConfiguration } from "@/lib/assistant/agent";
import { processNextAutomationJob } from "@/lib/automation";
import { processForwardingDeliveries } from "@/lib/whatsapp/forwarding";
import { processPendingWhatsAppMessageEchoes } from "@/lib/whatsapp/message-echoes";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const [forwarding, result] = await Promise.allSettled([
    processForwardingDeliveries(),
    processAssistantBatch(),
  ]);
  if (result.status === "rejected") throw result.reason;
  if (forwarding.status === "rejected") {
    console.error("WhatsApp forwarding worker failed.", { errorType: forwarding.reason instanceof Error ? forwarding.reason.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível processar os encaminhamentos." }, { status: 503 });
  }
  if (result.value.echoSyncFailures > 0) {
    return NextResponse.json({
      ...result.value, forwardingProcessed: forwarding.value,
      error: "Há eventos do WhatsApp pendentes de sincronização. O worker tentará novamente.",
    }, { status: 503 });
  }
  return NextResponse.json({ ...result.value, forwardingProcessed: forwarding.value });
}

async function processAssistantBatch() {
  const synchronization = await processPendingWhatsAppMessageEchoes();
  const echoResults = { echoesProcessed: synchronization.processed, echoSyncFailures: synchronization.failed };
  const batchSize = Math.min(Math.max(Number(process.env.ASSISTANT_WORKER_BATCH_SIZE) || 1, 1), 20);
  const settings = await getAgentConfiguration();
  if (!settings.enabled) {
    return { processed: 0, results: [], processingEnabled: false, ...echoResults };
  }
  const results = [];
  for (let index = 0; index < batchSize; index += 1) {
    const result = await processNextAutomationJob();
    if (!result.processed) break;
    results.push(result);
  }

  return { processed: results.length, results, ...echoResults };
}

function isAuthorized(authorization: string | null) {
  const secret = process.env.ASSISTANT_WORKER_SECRET;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}