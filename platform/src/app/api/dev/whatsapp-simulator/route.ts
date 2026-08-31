import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { processWhatsAppWebhook } from "@/lib/whatsapp";

interface SimulatedMessageInput {
  phone?: string;
  name?: string;
  body?: string;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as SimulatedMessageInput;
  const phone = input.phone?.replace(/\D/g, "") ?? "";
  const name = input.name?.trim() ?? "";
  const body = input.body?.trim() ?? "";

  if (!phone || !name || !body) {
    return NextResponse.json(
      { error: "Preencha nome, telefone com DDI e mensagem." },
      { status: 400 },
    );
  }
  if (body.length > 4096) {
    return NextResponse.json(
      { error: "A mensagem deve ter no máximo 4.096 caracteres." },
      { status: 400 },
    );
  }

  const messageId = `wamid.simulated.${randomUUID()}`;
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "simulated-business-account",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "simulated",
                phone_number_id:
                  process.env.WHATSAPP_PHONE_NUMBER_ID ?? "simulated-phone-number-id",
              },
              contacts: [{ profile: { name }, wa_id: phone }],
              messages: [
                {
                  from: phone,
                  id: messageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const result = await processWhatsAppWebhook(JSON.stringify(payload));
  return NextResponse.json({ messageId, payload, ...result }, { status: 201 });
}