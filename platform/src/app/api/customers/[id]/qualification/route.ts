import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { analyzeAndSaveCustomerLeadQualification } from "@/lib/qualification/customer-lead";
import { getQualificationLockStatus, QualificationInProgressError } from "@/lib/qualification/lock";

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

  const status = await getQualificationLockStatus(new ObjectId(id));
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

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
    if (error instanceof QualificationInProgressError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao qualificar o lead." },
      { status: 400 },
    );
  }
}