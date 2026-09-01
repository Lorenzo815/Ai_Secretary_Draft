import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { analyzeAndSaveCustomerLeadQualification } from "@/lib/qualification/customer-lead";

export async function POST(
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
    const qualification = await analyzeAndSaveCustomerLeadQualification(new ObjectId(id), { force: true });
    return NextResponse.json({ qualification });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao qualificar o lead." },
      { status: 400 },
    );
  }
}