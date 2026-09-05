import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { activateEmbeddedSignupConnection } from "@/lib/whatsapp";

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (typeof input.connectionId !== "string") {
      return NextResponse.json({ error: "Conexão inválida." }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      ...await activateEmbeddedSignupConnection(input.connectionId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível ativar a conexão." },
      { status: 400 },
    );
  }
}