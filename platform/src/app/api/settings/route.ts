import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { clearDynamicData, clearDynamicDataForCustomer } from "@/lib/admin/database";
import { getAgentConfiguration, setAgentEnabled, updateAgentPaymentSettings } from "@/lib/assistant/agent";
import { authOptions } from "@/lib/auth";
import {
  clearStoredMercadoPagoCredential,
  getMercadoPagoCredentialStatus,
  saveMercadoPagoCredential,
  updatePaymentProviderConfiguration,
  type PaymentProvider,
} from "@/lib/payments";
import { checkMercadoPagoAccount } from "@/lib/payments/providers/mercado-pago";

export async function PUT(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  if (input.paymentProvider && typeof input.paymentProvider === "object") {
    const provider = input.paymentProvider as Record<string, unknown>;
    try {
      const credentialStatus = await getMercadoPagoCredentialStatus();
      if (provider.activeProvider === "mercado_pago" && !credentialStatus.configured) {
        return NextResponse.json({ error: "Configure e teste a conta Mercado Pago antes de ativá-la." }, { status: 409 });
      }
      const configuration = await updatePaymentProviderConfiguration({
        activeProvider: provider.activeProvider as PaymentProvider,
        humanFallbackEnabled: provider.humanFallbackEnabled === true,
        updatedBy: "settings",
      });
      return NextResponse.json({ configuration, credentialStatus });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível salvar o provedor de pagamento." },
        { status: 400 },
      );
    }
  }
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

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json() as { mercadoPago?: { accessToken?: string; webhookSecret?: string; clear?: boolean } };
  if (!input.mercadoPago) return NextResponse.json({ error: "Operação de credencial inválida." }, { status: 400 });
  try {
    if (input.mercadoPago.clear) await clearStoredMercadoPagoCredential();
    else await saveMercadoPagoCredential({
      accessToken: input.mercadoPago.accessToken ?? "",
      webhookSecret: input.mercadoPago.webhookSecret ?? "",
      updatedBy: session.user?.email ?? "settings",
    });
    return NextResponse.json({ credentialStatus: await getMercadoPagoCredentialStatus() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível atualizar as credenciais." },
      { status: 400 },
    );
  }
}

export async function POST() {
  if (!(await getServerSession(authOptions))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ account: await checkMercadoPagoAccount() });
  } catch {
    return NextResponse.json({ error: "A conta Mercado Pago não respondeu corretamente. Verifique o Access Token." }, { status: 502 });
  }
}