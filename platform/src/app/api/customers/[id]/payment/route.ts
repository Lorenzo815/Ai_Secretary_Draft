import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { emitAutomationEvent } from "@/lib/automation";
import { authOptions } from "@/lib/auth";
import { updateCustomerServiceStatus } from "@/lib/crm";
import { reviewPaymentRequest } from "@/lib/payments";
import { saveWhatsAppMessage, sendTextMessage } from "@/lib/whatsapp";

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

    let deliveryWarning: string | undefined;
    await emitAutomationEvent({
      type: "payment.status.changed",
      customerId,
      occurredAt: new Date(),
      payload: { status },
    });
    if (status === "paid") {
      const customer = await updateCustomerServiceStatus(customerId, "ai_active");
      const contactPhone = customer.phones[0];
      if (contactPhone) {
        const body = "Pagamento confirmado pela equipe. Agora vamos encontrar as melhores opções para sua Bioimpedância e Consulta com o Dr. Matheus. Você prefere realizá-las próximas uma da outra ou em dias e horários diferentes?";
        try {
          const sent = await sendTextMessage({ to: contactPhone, body });
          await saveWhatsAppMessage({
            customerId,
            metaMessageId: sent.messageId,
            contactPhone,
            contactName: customer.name,
            direction: "outbound",
            type: "text",
            body,
            status: "sent",
            timestamp: new Date(),
          });
        } catch (error) {
          deliveryWarning = error instanceof Error ? error.message : "Não foi possível avisar o cliente.";
        }
      }
    } else {
      await updateCustomerServiceStatus(customerId, "human_active");
    }

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