import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { findCustomerById, updateCustomer } from "@/lib/crm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const customer = await findCustomerById(id);
  if (!customer) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }
  return NextResponse.json(
    {
      customer: {
        id: customer._id.toString(),
        name: customer.name,
        phone: customer.phones[0] ?? "",
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (typeof input.name !== "string" || typeof input.whatsapp !== "string") {
      return NextResponse.json({ error: "Nome e WhatsApp são obrigatórios." }, { status: 400 });
    }
    const { id } = await params;
    const customer = await updateCustomer(id, {
      name: input.name,
      fullName: optionalString(input.fullName),
      whatsapp: input.whatsapp,
      relationshipStatus: input.relationshipStatus === "new" || input.relationshipStatus === "returning"
        ? input.relationshipStatus
        : input.relationshipStatus === "unknown" ? null : undefined,
      birthDate: optionalString(input.birthDate),
      cpf: optionalString(input.cpf),
      postalCode: optionalString(input.postalCode),
      street: optionalString(input.street),
      neighborhood: optionalString(input.neighborhood),
      city: optionalString(input.city),
      state: optionalString(input.state),
      addressNumber: optionalString(input.addressNumber),
      addressComplement: optionalString(input.addressComplement),
      profession: optionalString(input.profession),
      secondaryPhones: Array.isArray(input.secondaryPhones) && input.secondaryPhones.every((phone) => typeof phone === "string")
        ? input.secondaryPhones
        : undefined,
    });
    return NextResponse.json({
      customer: { id: customer._id.toString(), name: customer.name, phone: customer.phones[0] },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível editar o cliente." },
      { status: 409 },
    );
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
