import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createCalendarAccessEvent, listCalendarAccessEvents } from "@/lib/calendar";

export async function GET() {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return NextResponse.json({ accessEvents: await listCalendarAccessEvents() });
}

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (
      (input.type !== "permission" && input.type !== "blocker")
      || typeof input.title !== "string"
      || typeof input.startAt !== "string"
      || typeof input.endAt !== "string"
      || !Array.isArray(input.resourceIds)
      || !input.resourceIds.every((resourceId) => typeof resourceId === "string")
    ) {
      return NextResponse.json({ error: "Dados da regra de agenda inválidos." }, { status: 400 });
    }
    const accessEvent = await createCalendarAccessEvent({
      type: input.type,
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      resourceIds: input.resourceIds,
    });
    return NextResponse.json({ accessEvent }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível criar a regra de agenda." },
      { status: 409 },
    );
  }
}
