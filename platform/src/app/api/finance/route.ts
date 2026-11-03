import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { FinanceError, listFinance, registerManualPayment } from "@/lib/payments";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const source = params.get("source");
  try {
    const result = await listFinance({
      view: params.get("view") === "all" ? "all" : "processed",
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      customerId: params.get("customerId") || undefined,
      source: source === "mercado_pago" || source === "manual" ? source : undefined,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "Não foi possível carregar os pagamentos.");
  }
}

/** Registers a payment received outside the system (cash, card machine, direct Pix, transfer, insurance). */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json().catch(() => null) as {
    customerId?: unknown; amountCents?: unknown; method?: unknown; receivedAt?: unknown; note?: unknown; appointmentIds?: unknown;
  } | null;
  if (!input || typeof input.customerId !== "string" || !ObjectId.isValid(input.customerId) ||
    typeof input.amountCents !== "number" || typeof input.method !== "string" || typeof input.receivedAt !== "string" ||
    !Array.isArray(input.appointmentIds) || input.appointmentIds.some((id) => typeof id !== "string" || !ObjectId.isValid(id))) {
    return NextResponse.json({ error: "Pagamento inválido." }, { status: 400 });
  }
  try {
    const payment = await registerManualPayment({
      customerId: new ObjectId(input.customerId),
      amountCents: input.amountCents,
      method: input.method,
      receivedAt: new Date(input.receivedAt),
      note: typeof input.note === "string" ? input.note : undefined,
      appointmentIds: (input.appointmentIds as string[]).map((id) => new ObjectId(id)),
      createdBy: session.user.email,
    });
    return NextResponse.json({ payment: { id: payment._id.toHexString() } }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return failure(error, "Não foi possível registrar o pagamento.");
  }
}

function failure(error: unknown, fallback: string) {
  if (error instanceof FinanceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, { errorType: error instanceof Error ? error.name : "Unknown" });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}
