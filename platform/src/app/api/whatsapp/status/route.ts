import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getWhatsAppPublicStatus } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  return NextResponse.json({
    ...await getWhatsAppPublicStatus(),
    webhookUrl: new URL("/api/webhooks/whatsapp", request.nextUrl.origin).toString(),
  });
}