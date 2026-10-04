import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { fetchWhatsAppMediaFile, findWhatsAppMessageByMetaId } from "@/lib/whatsapp";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { messageId } = await params;
  const message = await findWhatsAppMessageByMetaId(messageId);
  if (!message?.media?.id || (message.type !== "image" && message.type !== "audio")) {
    return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
  }

  try {
    const media = await fetchWhatsAppMediaFile(message.media.id, message.type);
    return new NextResponse(media.bytes, {
      headers: {
        "Content-Type": media.mimeType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar a mídia." },
      { status: 502 },
    );
  }
}