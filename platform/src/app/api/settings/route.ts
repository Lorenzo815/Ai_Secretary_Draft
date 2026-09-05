import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { clearDynamicData, clearDynamicDataForCustomer } from "@/lib/admin/database";
import { getAgentConfiguration, setAgentEnabled, updateAgentPaymentSettings } from "@/lib/assistant/agent";
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
      const current = await getAgentConfiguration();
      const settings = await updateAgentPaymentSettings({
        pixKey: payment.pixKey.trim() || current.payment.pixKey,
        recipientName: payment.recipientName,
        signalAmountCents: payment.signalAmountCents,
      });
      return NextResponse.json({ paymentConfigured: Boolean(settings.payment.pixKey && settings.payment.recipientName) });
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

  const settings = await setAgentEnabled(input.processingEnabled);
  return NextResponse.json({ processingEnabled: settings.enabled });
}

export async function DELETE(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  if (input.confirmation !== "APAGAR") {
    return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
  }

  const settings = await getAgentConfiguration();
  if (settings.enabled) {
    return NextResponse.json(
      { error: "Pause o processamento da IA antes de apagar os dados dinâmicos." },
      { status: 409 },
    );
  }

  if (input.scope !== "all" && input.scope !== "customer") {
    return NextResponse.json({ error: "Escopo de exclusão inválido." }, { status: 400 });
  }

  let deleted;
  if (input.scope === "customer") {
    if (typeof input.customerId !== "string" || !ObjectId.isValid(input.customerId)) {
      return NextResponse.json({ error: "Selecione um cliente válido." }, { status: 400 });
    }
    deleted = await clearDynamicDataForCustomer(new ObjectId(input.customerId));
    if (!deleted) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }
  } else {
    deleted = await clearDynamicData();
  }
  const deletedCount = Object.values(deleted).reduce((total, count) => total + count, 0);
  return NextResponse.json({ deleted, deletedCount, scope: input.scope });
}