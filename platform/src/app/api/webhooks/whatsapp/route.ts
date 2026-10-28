import { after, NextRequest, NextResponse } from "next/server";
import {
  isValidWebhookSignature,
} from "@/lib/whatsapp";
import { enqueueWhatsAppForwarding, ForwardingRoutingError, processForwardingDeliveries } from "@/lib/whatsapp/forwarding";
import { ManagementError } from "@/lib/access/management";
import { handleWhatsAppWebhook } from "./handler";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const verifyToken = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    challenge &&
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    verifyToken === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Verificação inválida." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const body = new Uint8Array(await request.arrayBuffer());
  const rawBody = Buffer.from(body).toString("utf8");
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.error("WhatsApp webhook rejected: WHATSAPP_APP_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }
  const signature = request.headers.get("x-hub-signature-256");
  if (!signature || !isValidWebhookSignature(body, signature)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  if (request.headers.has("x-oria-webhook-forwarded")) {
    return NextResponse.json({ error: "Encaminhamento circular não permitido." }, { status: 400 });
  }

  try {
    const queued = await enqueueWhatsAppForwarding(body, signature);
    if (queued > 0) after(async () => {
      try { await processForwardingDeliveries(); }
      catch (error) {
        console.error("WhatsApp forwarding worker failed; deliveries remain queued.", { errorType: error instanceof Error ? error.name : "Unknown" });
      }
    });
  } catch (error) {
    if (error instanceof ManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("WhatsApp forwarding enqueue failed.", {
      errorType: error instanceof Error ? error.name : "Unknown",
      ...(error instanceof ForwardingRoutingError ? { code: error.code } : {}),
    });
    return NextResponse.json({ error: "Não foi possível registrar os encaminhamentos. Tente novamente.", code: "WEBHOOK_FORWARDING_UNAVAILABLE" }, { status: 503 });
  }

  return handleWhatsAppWebhook(rawBody, request.nextUrl.origin);
}