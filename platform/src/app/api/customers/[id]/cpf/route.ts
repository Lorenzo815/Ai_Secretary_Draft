import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { revealCustomerCpf } from "@/lib/crm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  try {
    const cpf = await revealCustomerCpf(new ObjectId(id));
    if (!cpf) {
      return NextResponse.json(
        { error: "CPF não cadastrado para este cliente." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { cpf: formatCpf(cpf) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to reveal customer CPF.", error);
    return NextResponse.json(
      { error: "Não foi possível exibir o CPF." },
      { status: 500 },
    );
  }
}

function formatCpf(cpf: string) {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
