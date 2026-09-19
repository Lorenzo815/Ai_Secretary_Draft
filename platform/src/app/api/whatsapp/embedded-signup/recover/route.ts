import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { recoverEmbeddedSignupConnection } from "@/lib/whatsapp";

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (typeof input.connectionId !== "string") {
      return NextResponse.json({ error: "Conexão temporária inválida." }, { status: 400 });
    }
    if (input.phoneNumberId !== undefined && typeof input.phoneNumberId !== "string") {
      return NextResponse.json({ error: "Telefone selecionado inválido." }, { status: 400 });
    }
    const result = await recoverEmbeddedSignupConnection({
      connectionId: input.connectionId,
      phoneNumberId: input.phoneNumberId,
    });
    if (!result) {
      return NextResponse.json({ pending: true }, { status: 202 });
    }
    if ("selectionRequired" in result) {
      return NextResponse.json(result);
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível recuperar a confirmação da Meta." },
      { status: 400 },
    );
  }
}
