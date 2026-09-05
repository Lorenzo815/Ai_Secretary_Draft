import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { updateEmbeddedSignupConfiguration } from "@/lib/whatsapp";

export async function PUT(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  if (typeof input.appId !== "string" || typeof input.configurationId !== "string") {
    return NextResponse.json({ error: "Configuração do Cadastro Incorporado inválida." }, { status: 400 });
  }

  try {
    const configuration = await updateEmbeddedSignupConfiguration({
      appId: input.appId,
      configurationId: input.configurationId,
    });
    return NextResponse.json({
      appId: configuration.appId,
      configurationId: configuration.configurationId,
      graphVersion: configuration.graphVersion,
      updatedAt: configuration.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível salvar a configuração." },
      { status: 400 },
    );
  }
}