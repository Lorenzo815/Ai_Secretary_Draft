import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { allocatePayment, FinanceError, removeManualPayment } from "@/lib/payments";

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

/** Removes a payment registered by staff. Its appointments stay booked, without the payment reference. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Pagamento inválido." }, { status: 400 });
  const input = await request.json().catch(() => ({})) as { reason?: unknown };
  try {
    await removeManualPayment({
      paymentRequestId: new ObjectId(id),
      removedBy: session.user.email,
      reason: typeof input.reason === "string" ? input.reason : undefined,
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    if (error instanceof FinanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Manual payment removal failed.", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível remover o pagamento." }, { status: 500 });
  }
}
