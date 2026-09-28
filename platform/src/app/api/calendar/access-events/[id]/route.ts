import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { deleteCalendarAccessEvent, updateCalendarAccessEvent } from "@/lib/calendar";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params;
    const accessEvent = await updateCalendarAccessEvent(id, {
      type: input.type,
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      resourceIds: input.resourceIds,
    });
    return NextResponse.json({ accessEvent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível editar a regra de agenda." },
      { status: 409 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const { id } = await params;
    await deleteCalendarAccessEvent(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível remover a regra de agenda." },
      { status: 400 },
    );
  }
}
