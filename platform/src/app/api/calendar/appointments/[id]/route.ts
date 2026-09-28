import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { cancelAppointment, deleteAppointment, updateAppointmentConfirmation, updateManualAppointment } from "@/lib/calendar";
import { findCustomerById } from "@/lib/crm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const input = (await request.json()) as {
    customerId?: string | null;
    startAt?: string;
    eventType?: string;
    resourceId?: string;
    customTitle?: string;
    durationMinutes?: number;
    allowOutsideAvailability?: boolean;
    confirmationStatus?: "pending" | "confirmed";
    notes?: string;
  };
  const { id } = await params;
  if (
    input.confirmationStatus
    && input.startAt === undefined
    && input.eventType === undefined
  ) {
    try {
      return NextResponse.json({
        appointment: await updateAppointmentConfirmation(id, input.confirmationStatus),
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Falha ao confirmar evento." },
        { status: 409 },
      );
    }
  }
  if (
    !input.startAt
    || !input.eventType
    || (input.customerId !== undefined && input.customerId !== null && typeof input.customerId !== "string")
    || (input.notes !== undefined && typeof input.notes !== "string")
  ) {
    return NextResponse.json({ error: "Dados do evento inválidos. Informe tipo, data e hora." }, { status: 400 });
  }
  const customer = input.customerId ? await findCustomerById(input.customerId) : null;
  if (input.customerId && !customer) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  try {
    const appointment = await updateManualAppointment({
      appointmentId: id,
      customerId: customer?._id,
      customerName: customer?.name ?? "",
      contactPhone: customer?.phones[0] ?? "",
      startAt: input.startAt,
      eventType: input.eventType,
      resourceId: input.resourceId,
      customTitle: input.customTitle,
      durationMinutes: input.durationMinutes,
      allowOutsideAvailability: input.allowOutsideAvailability,
      confirmationStatus: input.confirmationStatus,
      notes: input.notes,
    });
    return NextResponse.json({ appointment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao editar evento." },
      { status: 409 },
    );
  }
}

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