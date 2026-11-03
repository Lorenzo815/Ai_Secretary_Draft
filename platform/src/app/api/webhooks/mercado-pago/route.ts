import { NextResponse } from "next/server";
import { parseCompanyId, runWithCompany } from "@/lib/companies/context";
import { legacyCompanyId } from "@/lib/companies/ownership";
import { processMercadoPagoWebhook, WebhookError } from "@/lib/payments/mercado-pago-webhook";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { type?: string; topic?: string; data?: { id?: string | number } };
    const url = new URL(request.url);
    // Orders (Pix in the chat) and payments (payment link, and every attempt): anything else is acknowledged so it isn't retried.
    const topic = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? body.type ?? body.topic ?? "order";
    if (topic !== "order" && topic !== "payment") return NextResponse.json({ processed: false, ignored: topic });
    const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? "");
    if (!dataId) return NextResponse.json({ error: "Identificador ausente." }, { status: 400 });
    // The original clinic's Mercado Pago account was registered without `company`. For any other
    // company, the signature is checked with that company's own secret, so the parameter can't be forged.
    const companyParam = url.searchParams.get("company");
    const companyId = companyParam === null ? legacyCompanyId() : parseCompanyId(companyParam);
    if (!companyId) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
    const result = await runWithCompany(companyId, () => processMercadoPagoWebhook({
      topic,
      dataId,
      signature: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WebhookError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Mercado Pago webhook failed", error);
    return NextResponse.json({ error: "Falha ao processar notificação." }, { status: 500 });
  }
}