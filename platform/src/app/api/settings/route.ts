import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { clearDynamicData } from "@/lib/admin/database";
import { getAssistantSettings, setAssistantProcessingEnabled, updatePaymentSettings } from "@/lib/assistant";
import { authOptions } from "@/lib/auth";

export async function PUT(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  if (input.payment && typeof input.payment === "object") {
    const payment = input.payment as Record<string, unknown>;
    if (
      typeof payment.pixKey !== "string" ||
      typeof payment.recipientName !== "string" ||
      typeof payment.signalAmountCents !== "number"
    ) {
      return NextResponse.json({ error: "Configuração Pix inválida." }, { status: 400 });
    }
    try {
      const settings = await updatePaymentSettings({
        pixKey: payment.pixKey,
        recipientName: payment.recipientName,
        signalAmountCents: payment.signalAmountCents,
      });
      return NextResponse.json({ payment: settings?.payment });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível salvar o Pix." },
        { status: 400 },
      );
    }
  }
  if (typeof input.processingEnabled !== "boolean") {
    return NextResponse.json({ error: "Configuração de processamento inválida." }, { status: 400 });
  }

  const settings = await setAssistantProcessingEnabled(input.processingEnabled);
  return NextResponse.json({ settings });
}

export async function DELETE(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  if (input.confirmation !== "APAGAR") {
    return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
  }

  const settings = await getAssistantSettings();
  if (settings.processingEnabled) {
    return NextResponse.json(
      { error: "Pause o processamento da IA antes de apagar os dados dinâmicos." },
      { status: 409 },
    );
  }

  const deleted = await clearDynamicData();
  const deletedCount = Object.values(deleted).reduce((total, count) => total + count, 0);
  return NextResponse.json({ deleted, deletedCount });
}