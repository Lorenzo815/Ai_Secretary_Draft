import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { assignCustomerFlow } from "@/lib/assistant";
import { findCustomerById } from "@/lib/crm";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const customer = await findCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  const input = (await request.json()) as { flowKey?: string; reason?: string };
  if (!input.flowKey || !input.reason?.trim()) {
    return NextResponse.json(
      { error: "Selecione o fluxo e informe o motivo da alteração." },
      { status: 400 },
    );
  }

  try {
    const assignment = await assignCustomerFlow(
      customer._id,
      input.flowKey,
      "manual",
      input.reason.trim(),
    );
    return NextResponse.json({ assignment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atribuir fluxo." },
      { status: 400 },
    );
  }
}