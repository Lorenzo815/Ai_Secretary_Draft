// Per-plan deposit rules, shared by the AI tools, Agent Studio and the finance screens (no database access).
import type { AgentConditionGroup, PlanPaymentRequirement, SchedulingPlan, SchedulingPlanPayment } from "../assistant/agent/contracts";

export const PAYMENT_STATUS_FIELD = "operations.paymentStatus";
export const PLAN_PAYMENT_REQUIREMENTS: PlanPaymentRequirement[] = ["always", "first_time", "none"];
export const MIN_DEPOSIT_CENTS = 100;
export const MAX_DEPOSIT_CENTS = 1_000_000;

/**
 * The plan's deposit rule. Plans saved before rules were per plan required a deposit through the
 * prerequisite "operations.paymentStatus = paid" and used the clinic-wide amount: they read as "always".
 */
export function resolvePlanPayment(plan: Pick<SchedulingPlan, "payment" | "prerequisites">, legacyAmountCents: number): SchedulingPlanPayment {
  if (plan.payment) return plan.payment;
  return { requirement: referencesPaymentStatus(plan.prerequisites) ? "always" : "none", amountCents: legacyAmountCents };
}

/** Prerequisites without the legacy payment condition: deposits are governed by the plan's payment rule. */
export function withoutPaymentConditions(group: AgentConditionGroup): AgentConditionGroup {
  const strip = (conditions?: AgentConditionGroup["all"]) => conditions?.filter((condition) => condition.field !== PAYMENT_STATUS_FIELD);
  const all = strip(group.all);
  const any = strip(group.any);
  return {
    ...(all && all.length ? { all } : {}),
    ...(any && any.length ? { any } : {}),
  };
}

export function referencesPaymentStatus(group: AgentConditionGroup | undefined) {
  return [...(group?.all ?? []), ...(group?.any ?? [])].some((condition) => condition.field === PAYMENT_STATUS_FIELD);
}

/** Whether a new booking of this plan needs a deposit. */
export function depositRequired(payment: SchedulingPlanPayment, history: { hasPaidDepositBefore: boolean }) {
  if (payment.requirement === "always") return true;
  if (payment.requirement === "first_time") return !history.hasPaidDepositBefore;
  return false;
}

export function validatePlanPayment(value: unknown, planName: string): SchedulingPlanPayment {
  const payment = value as Partial<SchedulingPlanPayment> | undefined;
  if (!payment || !PLAN_PAYMENT_REQUIREMENTS.includes(payment.requirement as PlanPaymentRequirement)) {
    throw new Error(`Escolha a exigência de pagamento do plano ${planName}.`);
  }
  if (!Number.isInteger(payment.amountCents) || payment.amountCents! < MIN_DEPOSIT_CENTS || payment.amountCents! > MAX_DEPOSIT_CENTS) {
    throw new Error(`O sinal do plano ${planName} deve ser de R$ 1,00 a R$ 10.000,00.`);
  }
  return { requirement: payment.requirement as PlanPaymentRequirement, amountCents: payment.amountCents! };
}

export const PLAN_PAYMENT_LABELS: Record<PlanPaymentRequirement, string> = {
  always: "Obrigatório em todo agendamento",
  first_time: "Somente na primeira vez",
  none: "Não obrigatório",
};

export function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
