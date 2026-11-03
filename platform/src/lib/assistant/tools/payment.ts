import "server-only";

import { extendHeldSchedulingPlanOptions } from "../../calendar/plans";
import { currentCompanyId } from "../../companies/context";
import { legacyCompanyId } from "../../companies/ownership";
import {
  createMercadoPagoPaymentRequest, createPaymentRequest, enabledPaymentMethods, getPaymentProviderConfiguration,
  MERCADO_PAGO_WEBHOOK_PATH, type MercadoPagoChannel, type PaymentRequestDocument,
} from "../../payments";
import type { ToolExecution, ToolExecutionContext } from "./contracts";

// A boleto paid through the link may take up to 3 business days to clear; the slot stays held meanwhile.
const BOLETO_CLEARING_MS = 3 * 24 * 60 * 60 * 1000;

export async function executePaymentRequestTool(
  context: ToolExecutionContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  if (args.confirmedByCustomer !== true) {
    return validationError("confirmedByCustomer", "confirmation_required", "Confirme primeiro se o cliente deseja pagar o sinal.");
  }
  try {
    const settings = context.configuration;
    const providerSettings = await getPaymentProviderConfiguration();
    const methods = enabledPaymentMethods(providerSettings);
    const requested = args.method === "pix" || args.method === "payment_link" ? args.method : null;
    const usesMercadoPago = providerSettings.activeProvider === "mercado_pago";
    const channel: MercadoPagoChannel | null = !usesMercadoPago ? null : requested ?? (methods.length === 1 ? methods[0] : null);
    if (usesMercadoPago && !channel) {
      return validationError("method", "method_required",
        "A clínica aceita Pix no chat e link de pagamento (cartão/boleto). Pergunte ao cliente qual prefere e envie method.");
    }
    if (usesMercadoPago && channel && !methods.includes(channel)) {
      return validationError("method", "method_not_enabled", `A clínica não aceita ${channel === "pix" ? "Pix no chat" : "link de pagamento"}.`);
    }

    let payment: PaymentRequestDocument;
    try {
      payment = usesMercadoPago && channel
        ? await createMercadoPagoPaymentRequest({
            customerId: context.customerId,
            amountCents: settings.payment.signalAmountCents,
            payerEmail: typeof args.payerEmail === "string" ? args.payerEmail : "",
            payerName: context.customerName,
            channel,
            settings: providerSettings.mercadoPago,
            notificationUrl: await notificationUrl(),
          })
        : await createPaymentRequest({
            customerId: context.customerId,
            amountCents: settings.payment.signalAmountCents,
            pixKey: settings.payment.pixKey,
            recipientName: settings.payment.recipientName,
          });
    } catch (error) {
      if (!usesMercadoPago || !providerSettings.humanFallbackEnabled) throw error;
      payment = await createPaymentRequest({
        customerId: context.customerId,
        amountCents: settings.payment.signalAmountCents,
        pixKey: settings.payment.pixKey,
        recipientName: settings.payment.recipientName,
      });
    }

    // The slot must not be released while the patient can still pay.
    if (payment.expiresAt) {
      const boleto = payment.channel === "payment_link" && providerSettings.mercadoPago.linkMethods.includes("ticket");
      await extendHeldSchedulingPlanOptions(
        context.customerId,
        new Date(payment.expiresAt.getTime() + (boleto ? BOLETO_CLEARING_MS : 0)),
      );
    }

    return {
      output: JSON.stringify({
        ok: true,
        tool: "payment.request_deposit",
        paymentRequestId: payment._id.toString(),
        status: payment.status,
        amountCents: payment.amountCents,
        provider: payment.provider ?? "manual",
        channel: payment.provider === "mercado_pago" ? payment.channel ?? "pix" : "manual_pix",
        pixKey: payment.pixKeySnapshot,
        recipientName: payment.recipientNameSnapshot,
        qrCode: payment.qrCode,
        ticketUrl: payment.ticketUrl,
        paymentUrl: payment.paymentUrl,
        expiresAt: payment.expiresAt?.toISOString() ?? null,
        linkMethods: payment.channel === "payment_link" ? providerSettings.mercadoPago.linkMethods : undefined,
        maxInstallments: payment.channel === "payment_link" ? providerSettings.mercadoPago.maxInstallments : undefined,
      }),
      retryable: false,
    };
  } catch (error) {
    return {
      output: JSON.stringify({
        ok: false,
        type: "operational_error",
        message: error instanceof Error ? error.message : "Falha ao criar a solicitação de sinal.",
      }),
      retryable: false,
    };
  }
}

/** Mercado Pago sends link payments to this URL; `company` routes them to this clinic. Only public HTTPS URLs work. */
async function notificationUrl() {
  const base = process.env.NEXTAUTH_URL?.trim();
  if (!base?.startsWith("https://")) return undefined;
  const companyId = await currentCompanyId();
  const url = new URL(MERCADO_PAGO_WEBHOOK_PATH, base);
  if (!companyId.equals(legacyCompanyId())) url.searchParams.set("company", companyId.toHexString());
  return url.toString();
}

function validationError(field: string, code: string, message: string): ToolExecution {
  return {
    output: JSON.stringify({ ok: false, type: "validation_error", errors: [{ field, code, message }] }),
    retryable: true,
  };
}
