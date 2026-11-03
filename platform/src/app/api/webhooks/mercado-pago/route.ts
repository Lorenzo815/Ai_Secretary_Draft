import { NextResponse } from "next/server";
import { parseCompanyId, runWithCompany } from "@/lib/companies/context";
import { legacyCompanyId } from "@/lib/companies/ownership";
import { processMercadoPagoWebhook, WebhookError } from "@/lib/payments/mercado-pago-webhook";

export async function POST(request: Request) {
  const url = new URL(request.url);
  // One line per notification (no personal data), to see in the logs what Mercado Pago sent and what we did.
  const trace: Record<string, unknown> = {
    event: "mercado_pago_webhook",
    company: url.searchParams.get("company"),
    requestId: request.headers.get("x-request-id"),
  };
  const respond = (body: Record<string, unknown>, status = 200) => {
    console.info(JSON.stringify({ ...trace, httpStatus: status, ...body }));
    return NextResponse.json(body, { status });
  };
  try {
    const body = await request.json().catch(() => ({})) as { type?: string; topic?: string; action?: string; data?: { id?: string | number } };
    // Orders (Pix in the chat) and payments (payment link, and every attempt): anything else is acknowledged so it isn't retried.
    const topic = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? body.type ?? body.topic ?? "order";
    const dataId = String(url.searchParams.get("data.id") ?? body.data?.id ?? "");
    Object.assign(trace, { topic, action: body.action ?? null, dataId });
    if (topic !== "order" && topic !== "payment") return respond({ processed: false, ignored: topic });
    if (!dataId) return respond({ error: "Identificador ausente." }, 400);
    // The original clinic's Mercado Pago account was registered without `company`. For any other
    // company, the signature is checked with that company's own secret, so the parameter can't be forged.
    const companyParam = url.searchParams.get("company");
    const companyId = companyParam === null ? legacyCompanyId() : parseCompanyId(companyParam);
    if (!companyId) return respond({ error: "Empresa inválida." }, 400);
    const result = await runWithCompany(companyId, () => processMercadoPagoWebhook({
      topic,
      dataId,
      signature: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
    }));
    return respond({ ...result });
  } catch (error) {
    if (error instanceof WebhookError) return respond({ error: error.message }, error.status);
    console.error("Mercado Pago webhook failed", error);
    return respond({ error: "Falha ao processar notificação.", detail: error instanceof Error ? error.message.slice(0, 200) : "erro" }, 500);
  }
}