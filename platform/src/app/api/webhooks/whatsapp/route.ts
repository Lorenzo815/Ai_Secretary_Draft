import { NextRequest, NextResponse } from "next/server";
import {
  isValidWebhookSignature,
  processWhatsAppWebhook,
  WhatsAppWebhookError,
} from "@/lib/whatsapp";

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
  const rawBody = await request.text();
  if (!isValidWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  try {
    const result = await processWhatsAppWebhook(rawBody);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof WhatsAppWebhookError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}