import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { IntegrationWhatsAppTemplateError, sendIntegrationTemplate } from "@/lib/whatsapp/integration-templates";
import { WhatsAppTemplatePersistenceError } from "@/lib/whatsapp/template-messages";

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

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Envie Content-Type: application/json." }, { status: 415 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  try {
    const message = await sendIntegrationTemplate(input);
    return NextResponse.json({
      messaging_product: "whatsapp",
      messages: [{ id: message.messageId }],
      historySaved: true,
      message: { ...message, type: "template", direction: "outbound", timestamp: message.timestamp.toISOString() },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof IntegrationWhatsAppTemplateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WhatsAppTemplatePersistenceError) {
      return NextResponse.json({
        error: error.message, code: "TEMPLATE_HISTORY_SAVE_FAILED",
        messageId: error.messageId, acceptedByMeta: true, historySaved: false,
      }, { status: 503 });
    }
    console.error("WhatsApp integration template request failed.", {
      errorType: error instanceof Error ? error.name : "Unknown",
    });
    return NextResponse.json({
      error: "Não foi possível preparar o envio do template. Verifique a conexão e o catálogo configurados.",
      code: "TEMPLATE_INTEGRATION_UNAVAILABLE",
    }, { status: 502 });
  }
}
