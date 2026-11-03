import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listAllocatableAppointmentsForCustomer } from "@/lib/payments";

/** The patient's active holds and recent bookings, which a payment can be linked to. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId || !ObjectId.isValid(customerId)) return NextResponse.json({ error: "Paciente inválido." }, { status: 400 });
  const appointments = await listAllocatableAppointmentsForCustomer(new ObjectId(customerId));
  return NextResponse.json({ appointments }, { headers: { "Cache-Control": "private, no-store" } });
}
