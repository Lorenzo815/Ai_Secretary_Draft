import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { cancelAppointment, deleteAppointment } from "@/lib/calendar";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const { id } = await params;
    const permanent = new URL(request.url).searchParams.get("permanent") === "true";
    const appointment = permanent
      ? await deleteAppointment(id)
      : await cancelAppointment(id);
    return NextResponse.json({ appointment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao alterar evento." },
      { status: 400 },
    );
  }
}