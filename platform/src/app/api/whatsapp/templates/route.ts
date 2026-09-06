import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  createWhatsAppTemplate,
  listWhatsAppTemplates,
  type CreateWhatsAppTemplateInput,
} from "@/lib/whatsapp";

async function isAuthenticated() {
  return Boolean(await getServerSession(authOptions));
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const templates = await listWhatsAppTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível consultar os modelos.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const input = await request.json() as Partial<CreateWhatsAppTemplateInput>;
    if (!input.name || !input.language || !input.category || !input.body) {
      return NextResponse.json({ error: "Preencha nome, idioma, categoria e conteúdo." }, { status: 400 });
    }
    const template = await createWhatsAppTemplate(input as CreateWhatsAppTemplateInput);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível criar o modelo.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}