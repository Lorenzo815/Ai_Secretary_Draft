import { after, NextResponse } from "next/server";
import { processWhatsAppWebhook, WhatsAppWebhookError } from "@/lib/whatsapp";

export async function handleWhatsAppWebhook(rawBody: string, origin: string) {
  try {
    const result = await processWhatsAppWebhook(rawBody);
    if (result.processingRequests > 0) {
      after(async () => {
        const secret = process.env.ASSISTANT_WORKER_SECRET;
        if (!secret) {
          console.error("WhatsApp processing trigger skipped: ASSISTANT_WORKER_SECRET is not configured.");
          return;
        }
        const endpoint = new URL("/api/internal/assistant/process", origin);
        await Promise.all(Array.from({ length: result.processingRequests }, async () => {
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { Authorization: `Bearer ${secret}` },
              cache: "no-store",
              signal: AbortSignal.timeout(210_000),
            });
            if (!response.ok) {
              console.error(`WhatsApp processing trigger failed with HTTP ${response.status}.`);
            }
          } catch (error) {
            console.error("WhatsApp processing trigger failed", error);
          }
        }));
      });
    }
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof WhatsAppWebhookError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
