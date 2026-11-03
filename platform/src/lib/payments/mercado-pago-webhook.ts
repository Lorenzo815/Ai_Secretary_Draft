import "server-only";

import { completePaymentTransition } from "./completion";
import { recordMercadoPagoPayment } from "./ledger";
import { applyProviderPaymentStatus, findPaymentRequestById, markPaymentRefunded, type PaymentRequestDocument } from "./payments";
import { getMercadoPagoCredential } from "./provider-credentials";
import { findPaymentsByReference, getOrder, getPayment } from "./providers/mercado-pago";
import { verifyMercadoPagoWebhookSignature } from "./providers/mercado-pago-signature";
import type { MercadoPagoPayment } from "./providers/types";

export type MercadoPagoTopic = "order" | "payment";

/**
 * Handles a Mercado Pago notification. Both topics lead to the same reconciliation: every payment attempt
 * Mercado Pago recorded for the request is saved in the ledger, and the request becomes paid when one attempt is
 * approved for the full amount. A rejected card attempt doesn't end the request (the patient may try again on
 * the same link); only a cancelled or expired Pix order does.
 *
 * For a Pix in the chat the order is the source of truth: its mirror in /v1/payments can stay "pending" after
 * the order is processed (seen in the sandbox), so the order is always read, whichever topic arrived.
 */
export async function processMercadoPagoWebhook(input: {
  topic: MercadoPagoTopic;
  dataId: string;
  signature: string | null;
  requestId: string | null;
}) {
  const credential = await getMercadoPagoCredential();
  if (!credential) throw new WebhookError("Mercado Pago não configurado.", 503);
  if (!verifyMercadoPagoWebhookSignature({ ...input, secret: credential.webhookSecret })) {
    throw new WebhookError("Assinatura inválida.", 401);
  }

  const notifiedOrder = input.topic === "order" ? await getOrder(input.dataId) : null;
  const notifiedPayment = input.topic === "payment" ? await getPayment(input.dataId) : null;
  const reference = notifiedOrder?.externalReference ?? notifiedPayment?.externalReference ?? "";
  const request = await findPaymentRequestById(reference);
  if (!request || request.provider !== "mercado_pago") {
    throw new WebhookError(`Cobrança local não encontrada (referência "${reference.slice(0, 40)}").`, 404);
  }
  const order = notifiedOrder ?? (request.channel !== "payment_link" && request.externalPaymentId?.startsWith("ORD")
    ? await getOrder(request.externalPaymentId)
    : null);
  if (order && (order.orderId !== request.externalPaymentId || order.amountCents !== request.amountCents || order.currency !== "BRL")) {
    throw new WebhookError("Os dados da cobrança não conferem.", 409);
  }

  const channel = request.channel ?? "pix";
  const payments = mergePayments(await findPaymentsByReference(reference), [notifiedPayment, ...(order?.payments ?? [])]);
  for (const payment of payments) {
    await recordMercadoPagoPayment({ paymentRequestId: request._id, customerId: request.customerId, channel, payment });
  }
  const reversed = payments.find((payment) => payment.paymentId === request.providerPaymentId && REVERSALS.has(payment.status));
  if (request.status === "paid" && reversed) {
    // The booking stays as staff left it; the refund only stops counting as a previous deposit.
    await markPaymentRefunded(request._id, reversed.status);
    return { processed: false, status: reversed.status, recorded: payments.length };
  }

  const approved = payments.find((payment) =>
    payment.status === "approved" && payment.amountCents === request.amountCents && (payment.currency || "BRL") === "BRL");
  if (notifiedPayment?.status === "approved" && !approved) {
    throw new WebhookError("Os dados da cobrança não conferem.", 409);
  }
  const outcome = approved
    ? { status: "paid" as const, providerStatus: "approved", providerPaymentId: approved.paymentId }
    : order && ORDER_FAILURES.has(order.status)
      ? { status: "rejected" as const, providerStatus: order.status }
      : null;
  const providerStatus = order?.status ?? notifiedPayment?.status ?? "";
  if (!outcome) return { processed: false, status: providerStatus, recorded: payments.length };

  const transitioned = await applyProviderPaymentStatus({ paymentRequestId: request._id, ...outcome });
  if (!transitioned) return { processed: false, status: providerStatus, recorded: payments.length };
  const completion = await completePaymentTransition(transitioned as PaymentRequestDocument, outcome.status);
  return { processed: true, status: providerStatus, recorded: payments.length, ...completion };
}

// Order statuses: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status
const ORDER_FAILURES = new Set(["canceled", "failed", "expired"]);
const REVERSALS = new Set(["refunded", "charged_back"]);

/** Search results plus payments read directly (fresher than the search index), by payment id. */
function mergePayments(found: MercadoPagoPayment[], direct: Array<MercadoPagoPayment | null>) {
  const merged = new Map(found.map((payment) => [payment.paymentId, payment]));
  for (const payment of direct) if (payment?.paymentId) merged.set(payment.paymentId, payment);
  return [...merged.values()];
}

export class WebhookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
