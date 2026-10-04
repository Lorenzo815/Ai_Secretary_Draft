import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getWhatsAppInboxDetail,
  listWhatsAppInboxConversations,
  resolveWhatsAppInboxAttention,
  WhatsAppInboxConflictError,
} from "@/lib/whatsapp";

export async function GET(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const searchParams = new URL(request.url).searchParams;
  const customerId = searchParams.get("customerId");
  if (customerId && !ObjectId.isValid(customerId)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  const includeOutsideWindow = searchParams.get("includeOutsideWindow") === "true";
  const startAt = parseDate(searchParams.get("startAt"));
  const endAt = parseDate(searchParams.get("endAt"));
  if (includeOutsideWindow && (
    (searchParams.has("startAt") && !startAt)
    || (searchParams.has("endAt") && !endAt)
    || (startAt && endAt && startAt > endAt)
  )) {
    return NextResponse.json({ error: "Período de conversas inválido." }, { status: 400 });
  }
  try {
    const conversations = await listWhatsAppInboxConversations({
      includeOutsideWindow,
      startAt: startAt ?? undefined,
      endAt: endAt ?? undefined,
    });
    const detail = customerId && conversations.some((conversation) => conversation.customerId === customerId)
      ? await getWhatsAppInboxDetail(new ObjectId(customerId))
      : null;
    return NextResponse.json({ conversations, detail }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar as conversas." },
      { status: 500 },
    );
  }
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json() as { customerId?: string; messageId?: string };
  if (!input.customerId || !ObjectId.isValid(input.customerId) || !input.messageId?.trim()) {
    return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  }
  try {
    await resolveWhatsAppInboxAttention(
      new ObjectId(input.customerId),
      input.messageId.trim(),
      session.user?.email ?? "dashboard",
    );
    return NextResponse.json({ resolved: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível resolver a conversa." },
      { status: error instanceof WhatsAppInboxConflictError ? 409 : 400 },
    );
  }
}
