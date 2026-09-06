import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ManualWhatsAppMessageError, sendManualCustomerMessage } from "@/lib/whatsapp";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  try {
    const input = await request.json() as { body?: string };
    const message = await sendManualCustomerMessage({
      customerId: new ObjectId(id),
      body: input.body ?? "",
      sentBy: session.user.email,
    });
    return NextResponse.json({
      message: {
        ...message,
        timestamp: message.timestamp.toISOString(),
        windowExpiresAt: message.windowExpiresAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ManualWhatsAppMessageError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível enviar a mensagem." },
      { status: 502 },
    );
  }
}