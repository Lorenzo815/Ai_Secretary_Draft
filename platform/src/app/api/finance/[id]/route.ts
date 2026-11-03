import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { allocatePayment, FinanceError } from "@/lib/payments";

/** Sets the appointments a received payment covers. Linking a held appointment confirms it ("A confirmar"). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await params;
  const input = await request.json().catch(() => null) as { appointmentIds?: unknown } | null;
  if (!ObjectId.isValid(id) || !input || !Array.isArray(input.appointmentIds) ||
    input.appointmentIds.some((value) => typeof value !== "string" || !ObjectId.isValid(value))) {
    return NextResponse.json({ error: "Vínculo inválido." }, { status: 400 });
  }
  try {
    const payment = await allocatePayment({
      paymentRequestId: new ObjectId(id),
      appointmentIds: (input.appointmentIds as string[]).map((value) => new ObjectId(value)),
    });
    return NextResponse.json({ payment: { id, appointmentIds: (payment?.appointmentIds ?? []).map((value) => value.toHexString()) } });
  } catch (error) {
    if (error instanceof FinanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Payment allocation failed.", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível atualizar os agendamentos do pagamento." }, { status: 500 });
  }
}
