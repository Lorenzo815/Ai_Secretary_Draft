import "server-only";

import { getAssistantSettings } from "../flows";
import { createPaymentRequest } from "../../payments";
import type { ToolExecution, ToolExecutionContext } from "./contracts";

export async function executePaymentRequestTool(
  context: ToolExecutionContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  if (args.confirmedByCustomer !== true) {
    return {
      output: JSON.stringify({
        ok: false,
        type: "validation_error",
        errors: [{ field: "confirmedByCustomer", code: "confirmation_required", message: "Confirme primeiro se o cliente deseja pagar o sinal." }],
      }),
      retryable: true,
    };
  }
  try {
    const settings = await getAssistantSettings();
    const payment = await createPaymentRequest({
      customerId: context.customerId,
      amountCents: settings.payment.signalAmountCents,
      pixKey: settings.payment.pixKey,
      recipientName: settings.payment.recipientName,
    });
    return {
      output: JSON.stringify({
        ok: true,
        tool: "payment.request_deposit",
        paymentRequestId: payment._id.toString(),
        status: payment.status,
        amountCents: payment.amountCents,
        pixKey: payment.pixKeySnapshot,
        recipientName: payment.recipientNameSnapshot,
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