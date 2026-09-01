import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  sendSampleTemplate,
  SendTemplateInput,
  sendTextMessage,
  SendTextInput,
} from "@/lib/whatsapp";
import {
  ensureWhatsAppMessageIndexes,
  listWhatsAppMessages,
  saveWhatsAppMessage,
} from "@/lib/whatsapp";

async function isAuthenticated() {
  return Boolean(await getServerSession(authOptions));
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
  await ensureWhatsAppMessageIndexes();
  const messages = await listWhatsAppMessages(limit);

  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const input = (await request.json()) as
      | ({ kind: "text" } & Partial<SendTextInput>)
      | ({ kind?: "template" } & Partial<SendTemplateInput>);

    if (input.kind === "text") {
      if (!input.to || !input.body) {
        return NextResponse.json(
          { error: "Preencha o telefone e a mensagem." },
          { status: 400 },
        );
      }

      const result = await sendTextMessage(input as SendTextInput);
      await ensureWhatsAppMessageIndexes();
      await saveWhatsAppMessage({
        metaMessageId: result.messageId,
        contactPhone: result.to,
        direction: "outbound",
        type: "text",
        body: result.body,
        status: "sent",
        timestamp: new Date(),
      });

      return NextResponse.json({ messageId: result.messageId }, { status: 201 });
    }

    if (!input.to || !input.customerName || !input.orderNumber || !input.orderDate) {
      return NextResponse.json(
        { error: "Preencha telefone, cliente, pedido e data." },
        { status: 400 },
      );
    }

    const result = await sendSampleTemplate(input as SendTemplateInput);
    await ensureWhatsAppMessageIndexes();
    await saveWhatsAppMessage({
      metaMessageId: result.messageId,
      contactPhone: result.to,
      contactName: input.customerName,
      direction: "outbound",
      type: "template",
      body: `Confirmação do pedido ${input.orderNumber} para ${input.orderDate}`,
      status: "sent",
      timestamp: new Date(),
    });

    return NextResponse.json({ messageId: result.messageId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar mensagem.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}