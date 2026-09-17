import "server-only";

import { completePaymentTransition } from "./completion";
import { findPaymentRequestById, applyProviderPaymentStatus } from "./payments";
import { getMercadoPagoCredential } from "./provider-credentials";
import { mercadoPagoProvider } from "./providers/mercado-pago";
import { verifyMercadoPagoWebhookSignature } from "./providers/mercado-pago-signature";

export async function processMercadoPagoWebhook(input: {
  dataId: string;
  signature: string | null;
  requestId: string | null;
}) {
  const credential = await getMercadoPagoCredential();
  if (!credential) throw new WebhookError("Mercado Pago não configurado.", 503);
  if (!verifyMercadoPagoWebhookSignature({ ...input, secret: credential.webhookSecret })) {
    throw new WebhookError("Assinatura inválida.", 401);
  }

  const providerPayment = await mercadoPagoProvider.getPayment(input.dataId);
  const payment = await findPaymentRequestById(providerPayment.externalReference);
  if (!payment || payment.provider !== "mercado_pago") {
    throw new WebhookError("Cobrança local não encontrada.", 404);
  }
  if (
    payment.externalPaymentId !== providerPayment.externalPaymentId
    || payment.amountCents !== providerPayment.amountCents
    || providerPayment.currency !== "BRL"
  ) {
    throw new WebhookError("Os dados da cobrança não conferem.", 409);
  }

  const terminalStatus = mapTerminalStatus(providerPayment.status);
  if (!terminalStatus) return { processed: false, status: providerPayment.status };
  const transitioned = await applyProviderPaymentStatus({
    paymentRequestId: payment._id,
    externalPaymentId: providerPayment.externalPaymentId,
    status: terminalStatus,
    providerStatus: providerPayment.status,
  });
  if (!transitioned) return { processed: false, status: providerPayment.status };
  const completion = await completePaymentTransition(transitioned, terminalStatus);
  return { processed: true, status: providerPayment.status, ...completion };
}

function mapTerminalStatus(status: string): "paid" | "rejected" | null {
  if (status === "approved") return "paid";
  if (["rejected", "cancelled", "refunded", "charged_back"].includes(status)) return "rejected";
  return null;
}

export class WebhookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}