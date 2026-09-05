import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { verifyEmbeddedSignupAppCredentials } from "@/lib/whatsapp";

export async function GET() {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    await verifyEmbeddedSignupAppCredentials();
    return NextResponse.json({ ready: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível validar o aplicativo Meta." },
      { status: 400 },
    );
  }
}