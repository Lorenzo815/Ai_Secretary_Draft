import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAgentConfiguration } from "@/lib/assistant/agent";
import { processNextAutomationJob } from "@/lib/automation";
import { processForwardingDeliveries } from "@/lib/whatsapp/forwarding";

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
  return NextResponse.json({ ...result.value, forwardingProcessed: forwarding.value });
}

async function processAssistantBatch() {
  const batchSize = Math.min(Math.max(Number(process.env.ASSISTANT_WORKER_BATCH_SIZE) || 1, 1), 20);
  const settings = await getAgentConfiguration();
  if (!settings.enabled) {
    return { processed: 0, results: [], processingEnabled: false };
  }
  const results = [];
  for (let index = 0; index < batchSize; index += 1) {
    const result = await processNextAutomationJob();
    if (!result.processed) break;
    results.push(result);
  }

  return { processed: results.length, results };
}

function isAuthorized(authorization: string | null) {
  const secret = process.env.ASSISTANT_WORKER_SECRET;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}