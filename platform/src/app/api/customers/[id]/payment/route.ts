import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { completePaymentTransition, reviewPaymentRequest } from "@/lib/payments";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const input = await request.json() as { action?: "confirm" | "reject"; note?: string };
  if (!ObjectId.isValid(id) || (input.action !== "confirm" && input.action !== "reject")) {
    return NextResponse.json({ error: "Revisão inválida." }, { status: 400 });
  }

  try {
    const customerId = new ObjectId(id);
    const status = input.action === "confirm" ? "paid" : "rejected";
    const payment = await reviewPaymentRequest({
      customerId,
      status,
      reviewedBy: session.user.email,
      note: input.note,
    });

    const { deliveryWarning } = await completePaymentTransition(payment, status);

    return NextResponse.json({
      payment: { id: payment._id.toString(), status: payment.status },
      deliveryWarning,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível revisar o sinal." },
      { status: 400 },
    );
  }
}