import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { finalizeEmbeddedSignupConnection } from "@/lib/whatsapp";

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (
      typeof input.connectionId !== "string"
      || typeof input.wabaId !== "string"
      || (input.phoneNumberId !== undefined && typeof input.phoneNumberId !== "string")
    ) {
      return NextResponse.json({ error: "Dados da conexão de coexistência inválidos." }, { status: 400 });
    }
    const result = await finalizeEmbeddedSignupConnection({
      connectionId: input.connectionId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível finalizar a conexão." },
      { status: 400 },
    );
  }
}