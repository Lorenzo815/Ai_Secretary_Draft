import { NextResponse } from "next/server";
import { processMercadoPagoWebhook, WebhookError } from "@/lib/payments/mercado-pago-webhook";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { data?: { id?: string | number } };
    const url = new URL(request.url);
    const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? "");
    if (!dataId) return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
    const result = await processMercadoPagoWebhook({
      dataId,
      signature: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WebhookError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Mercado Pago webhook failed", error);
    return NextResponse.json({ error: "Falha ao processar notificação." }, { status: 500 });
  }
}