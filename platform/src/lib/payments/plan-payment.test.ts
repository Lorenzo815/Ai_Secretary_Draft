import { describe, expect, it } from "vitest";
import { depositRequired, resolvePlanPayment, validatePlanPayment, withoutPaymentConditions } from "./plan-payment";

const paidCondition = { field: "operations.paymentStatus", operator: "eq" as const, value: "paid" };
const profileCondition = { field: "customer.missingFieldsCount", operator: "eq" as const, value: 0 };

describe("plan deposit rules", () => {
  it("reads plans saved before per-plan rules: the payment prerequisite means always, with the clinic-wide amount", () => {
    expect(resolvePlanPayment({ prerequisites: { all: [profileCondition, paidCondition] } }, 10_000)).toEqual({ requirement: "always", amountCents: 10_000 });
    expect(resolvePlanPayment({ prerequisites: { all: [profileCondition] } }, 10_000)).toEqual({ requirement: "none", amountCents: 10_000 });
  });

  it("prefers the plan's own rule", () => {
    expect(resolvePlanPayment({ payment: { requirement: "first_time", amountCents: 5_000 }, prerequisites: { all: [paidCondition] } }, 10_000))
      .toEqual({ requirement: "first_time", amountCents: 5_000 });
  });

  it("decides per booking", () => {
    const rule = (requirement: "always" | "first_time" | "none") => ({ requirement, amountCents: 1_000 });
    expect(depositRequired(rule("always"), { hasPaidDepositBefore: true })).toBe(true);
    expect(depositRequired(rule("first_time"), { hasPaidDepositBefore: false })).toBe(true);
    expect(depositRequired(rule("first_time"), { hasPaidDepositBefore: true })).toBe(false);
    expect(depositRequired(rule("none"), { hasPaidDepositBefore: false })).toBe(false);
  });

  it("drops only the legacy payment condition from prerequisites", () => {
    expect(withoutPaymentConditions({ all: [profileCondition, paidCondition] })).toEqual({ all: [profileCondition] });
    expect(withoutPaymentConditions({ all: [paidCondition] })).toEqual({});
    expect(withoutPaymentConditions({ any: [paidCondition, profileCondition] })).toEqual({ any: [profileCondition] });
  });

  it("validates the rule and the amount", () => {
    expect(validatePlanPayment({ requirement: "always", amountCents: 10_000 }, "Plano")).toEqual({ requirement: "always", amountCents: 10_000 });
    expect(() => validatePlanPayment({ requirement: "sometimes", amountCents: 10_000 }, "Plano")).toThrow(/exigência/);
    expect(() => validatePlanPayment({ requirement: "none", amountCents: 50 }, "Plano")).toThrow(/R\$ 1,00/);
    expect(() => validatePlanPayment(undefined, "Plano")).toThrow();
  });
});
