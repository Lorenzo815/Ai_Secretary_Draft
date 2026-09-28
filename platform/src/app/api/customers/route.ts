import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createCustomer } from "@/lib/crm";

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const input = (await request.json()) as { name?: unknown; whatsapp?: unknown };
    if (typeof input.name !== "string" || typeof input.whatsapp !== "string") {
      return NextResponse.json({ error: "Nome e WhatsApp são obrigatórios." }, { status: 400 });
    }
    const customer = await createCustomer({ name: input.name, whatsapp: input.whatsapp });
    return NextResponse.json({
      customer: { id: customer._id.toString(), name: customer.name, phone: customer.phones[0] },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível criar o cliente." },
      { status: 409 },
    );
  }
}
