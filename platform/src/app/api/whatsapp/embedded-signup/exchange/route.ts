import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { exchangeEmbeddedSignupCode } from "@/lib/whatsapp";

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (typeof input.code !== "string") {
      return NextResponse.json({ error: "Código temporário da Meta inválido." }, { status: 400 });
    }
    const result = await exchangeEmbeddedSignupCode(input.code);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível trocar o código da Meta." },
      { status: 400 },
    );
  }
}