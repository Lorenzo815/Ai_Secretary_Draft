import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { fetchWhatsAppImageDataUrl, findWhatsAppMessageByMetaId } from "@/lib/whatsapp";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { messageId } = await params;
  const message = await findWhatsAppMessageByMetaId(messageId);
  if (!message?.media?.id || message.type !== "image") {
    return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });
  }

  try {
    const dataUrl = await fetchWhatsAppImageDataUrl(message.media.id);
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Formato de imagem inválido.");
    return new NextResponse(Buffer.from(match[2], "base64"), {
      headers: {
        "Content-Type": match[1],
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar a imagem." },
      { status: 502 },
    );
  }
}