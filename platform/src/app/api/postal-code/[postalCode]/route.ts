import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { resolvePostalCode } from "@/lib/crm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postalCode: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const { postalCode } = await params;
    const address = await resolvePostalCode(postalCode);
    return NextResponse.json(
      { address },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível consultar o CEP." },
      { status: 400 },
    );
  }
}
