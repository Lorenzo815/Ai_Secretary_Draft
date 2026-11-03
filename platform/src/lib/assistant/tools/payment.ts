import "server-only";

import { extendHeldSchedulingPlanOptions, getHeldSchedulingPlanOption } from "../../calendar/plans";
import { currentCompanyId } from "../../companies/context";
import { legacyCompanyId } from "../../companies/ownership";
import {
  createMercadoPagoPaymentRequest, createPaymentRequest, depositForPlan, enabledPaymentMethods, findLastPayerEmail, getPaymentProviderConfiguration,
  PAYER_EMAIL_PATTERN, PaymentInputError,
  MERCADO_PAGO_WEBHOOK_PATH, type MercadoPagoChannel, type PaymentAllocation, type PaymentRequestDocument,
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
    // The deposit is for one booking: the slots the patient is holding, under that plan's rule and amount.
    const held = await getHeldSchedulingPlanOption(context.customerId);
    if (!held) {
      return validationError("booking", "held_booking_required",
        "Não há reserva temporária ativa. Reserve o horário escolhido com calendar.hold antes de pedir o sinal.");
    }
    const plan = settings.schedulingPlans.find((item) => item.key === held.option.planKey);
    const deposit = plan ? await depositForPlan(context.customerId, plan, settings.payment.signalAmountCents) : null;
    if (!plan || !deposit?.required) {
      return validationError("booking", "deposit_not_required",
        "O plano desta reserva não exige sinal. Não peça pagamento; encaminhe para a equipe concluir o agendamento.");
    }
    const amountCents = deposit.amountCents;
    const allocation: PaymentAllocation = {
      planKey: plan.key,
      schedulingOptionId: held.option._id,
      appointmentIds: held.appointmentIds,
    };
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
    // Mercado Pago requires the payer's e-mail. A missing one is asked to the patient (or reused from an
    // earlier charge); it must never send the patient to the manual Pix fallback.
    let payerEmail = typeof args.payerEmail === "string" ? args.payerEmail.trim().toLowerCase() : "";
    if (usesMercadoPago && !PAYER_EMAIL_PATTERN.test(payerEmail)) payerEmail = (await findLastPayerEmail(context.customerId)) ?? "";
    if (usesMercadoPago && !PAYER_EMAIL_PATTERN.test(payerEmail)) {
      return validationError("payerEmail", "payer_email_required",
        "O Mercado Pago exige o e-mail do pagador. Peça o e-mail ao paciente e chame payment.request_deposit de novo com payerEmail.");
    }

    let payment: PaymentRequestDocument;
    try {
      payment = usesMercadoPago && channel
        ? await createMercadoPagoPaymentRequest({
            customerId: context.customerId,
            amountCents,
            payerEmail,
            payerName: context.customerName,
            channel,
            settings: providerSettings.mercadoPago,
            notificationUrl: await notificationUrl(),
            allocation,
          })
        : await createPaymentRequest({
            customerId: context.customerId,
            amountCents,
            pixKey: settings.payment.pixKey,
            recipientName: settings.payment.recipientName,
            allocation,
          });
    } catch (error) {
      if (!usesMercadoPago || !providerSettings.humanFallbackEnabled || error instanceof PaymentInputError) throw error;
      console.warn("Mercado Pago charge failed; using manual Pix fallback.", { error: error instanceof Error ? error.message.slice(0, 300) : "Unknown" });
      payment = await createPaymentRequest({
        customerId: context.customerId,
        amountCents,
        pixKey: settings.payment.pixKey,
        recipientName: settings.payment.recipientName,
        allocation,
      });
    }

    // The slot must not be released while the patient can still pay.
    if (payment.expiresAt) {
      const boleto = payment.channel === "payment_link" && providerSettings.mercadoPago.linkMethods.includes("ticket");
      await extendHeldSchedulingPlanOptions(
        context.customerId,
        new Date(payment.expiresAt.getTime() + (boleto ? BOLETO_CLEARING_MS : 0)),
        held.option._id,
      );
    }

    return {
      output: JSON.stringify({
        ok: true,
        tool: "payment.request_deposit",
        paymentRequestId: payment._id.toString(),
        status: payment.status,
        amountCents: payment.amountCents,
        planName: plan.name,
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
