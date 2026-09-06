import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  ManualWhatsAppMessageError,
  sendManualCustomerMessage,
  sendManualCustomerTemplate,
  type WhatsAppTemplateSendParameters,
} from "@/lib/whatsapp";

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
    const input = await request.json() as {
      kind?: "text" | "template";
      body?: string;
      templateId?: string;
      parameters?: WhatsAppTemplateSendParameters;
    };
    if (input.kind === "template") {
      if (
        !input.templateId
        || !input.parameters
        || !Array.isArray(input.parameters.header)
        || !Array.isArray(input.parameters.body)
        || !Array.isArray(input.parameters.buttonUrls)
      ) {
        return NextResponse.json({ error: "Selecione um modelo e preencha seus parâmetros." }, { status: 400 });
      }
      const message = await sendManualCustomerTemplate({
        customerId: new ObjectId(id),
        templateId: input.templateId,
        parameters: input.parameters,
        sentBy: session.user.email,
      });
      return NextResponse.json({
        message: { ...message, type: "template", timestamp: message.timestamp.toISOString() },
      }, { status: 201 });
    }

    const message = await sendManualCustomerMessage({
      customerId: new ObjectId(id),
      body: input.body ?? "",
      sentBy: session.user.email,
    });
    return NextResponse.json({
      message: {
        ...message,
        type: "text",
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