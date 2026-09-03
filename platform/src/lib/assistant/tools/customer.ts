import "server-only";

import { CustomerProfileValidationError, classifyCustomerRelationship, getCustomerProfileSnapshot, updateCustomerProfile } from "../../crm";
import { emitAutomationEvent } from "../../automation";
import type { ToolExecution, ToolExecutionContext } from "./contracts";

export async function executeRegisteredCustomerTool(
  tool: "classify_relationship" | "update_profile",
  context: ToolExecutionContext,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  try {
    if (tool === "classify_relationship") {
      if ((args.status !== "new" && args.status !== "returning") || args.confirmedByCustomer !== true) {
        return validationError("A classificação exige uma resposta explícita do cliente.");
      }
      const customer = await classifyCustomerRelationship(context.customerId, args.status);
      return success("customer.classify_relationship", getCustomerProfileSnapshot(customer));
    }

    const customer = await updateCustomerProfile(context.customerId, {
      fullName: optionalString(args.fullName),
      birthDate: optionalString(args.birthDate),
      cpf: optionalString(args.cpf),
      postalCode: optionalString(args.postalCode),
      addressNumber: optionalString(args.addressNumber),
      addressComplement: optionalString(args.addressComplement),
      secondaryPhones: Array.isArray(args.secondaryPhones)
        ? args.secondaryPhones.filter((value): value is string => typeof value === "string")
        : [],
      profession: optionalString(args.profession),
    });
    const profile = getCustomerProfileSnapshot(customer);
    await emitAutomationEvent({
      type: "customer.profile.updated",
      customerId: context.customerId,
      occurredAt: new Date(),
      payload: { missingFields: profile.missingFields },
    });
    return success("customer.update_profile", profile);
  } catch (error) {
    if (error instanceof CustomerProfileValidationError) {
      return customerInputError(error.message);
    }
    return operationalError();
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function success(tool: string, profile: ReturnType<typeof getCustomerProfileSnapshot>): ToolExecution {
  return { output: JSON.stringify({ ok: true, tool, profile }), retryable: false };
}

function validationError(message: string): ToolExecution {
  return {
    output: JSON.stringify({
      ok: false,
      type: "validation_error",
      errors: [{ field: "profile", code: "invalid_profile_data", message }],
    }),
    retryable: true,
  };
}

function customerInputError(message: string): ToolExecution {
  return {
    output: JSON.stringify({
      ok: false,
      type: "customer_input_error",
      errors: [{ field: "profile", code: "invalid_profile_data", message }],
      publicReply: message === "O CPF informado é inválido."
        ? "O CPF informado parece inválido. Pode conferir os 11 dígitos e me enviar novamente?"
        : `${message} Pode conferir e me enviar novamente?`,
    }),
    retryable: false,
  };
}

function operationalError(): ToolExecution {
  return {
    output: JSON.stringify({
      ok: false,
      type: "operational_error",
      error: "Não foi possível atualizar o cadastro agora.",
    }),
    retryable: false,
  };
}