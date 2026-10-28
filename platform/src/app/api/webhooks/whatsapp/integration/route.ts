import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handleWhatsAppWebhook } from "../handler";

export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_INTEGRATION_WEBHOOK_TOKEN;
  if (!secret) {
    console.error("WhatsApp integration webhook rejected: WHATSAPP_INTEGRATION_WEBHOOK_TOKEN is not configured.");
    return NextResponse.json({ error: "Webhook de integração não configurado." }, { status: 503 });
  }
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  if (!token || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  return handleWhatsAppWebhook(await request.text(), request.nextUrl.origin);
}
