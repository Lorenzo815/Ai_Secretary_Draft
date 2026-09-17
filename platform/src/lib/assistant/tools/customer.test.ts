import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "./contracts";

const { updateCustomerProfile } = vi.hoisted(() => ({
  updateCustomerProfile: vi.fn(),
}));

vi.mock("../../crm", () => ({
  CustomerProfileValidationError: class CustomerProfileValidationError extends Error {},
  classifyCustomerRelationship: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
  updateCustomerProfile,
}));
vi.mock("../../automation", () => ({ emitAutomationEvent: vi.fn() }));
vi.mock("../../qualification/triggers", () => ({ scheduleProfileCompletionQualification: vi.fn() }));

import { executeRegisteredCustomerTool } from "./customer";

describe("customer assistant tool failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks operational failures as retryable and logs no arguments", async () => {
    updateCustomerProfile.mockRejectedValue(new Error("database unavailable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const execution = await executeRegisteredCustomerTool(
      "update_profile",
      { customerId: new ObjectId() } as ToolExecutionContext,
      { addressNumber: "123" },
    );

    expect(execution.retryable).toBe(true);
    expect(JSON.parse(execution.output)).toMatchObject({ ok: false, type: "operational_error" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Customer assistant tool failed",
      expect.objectContaining({
        tool: "customer.update_profile",
        errorName: "Error",
      }),
    );
    expect(consoleSpy.mock.calls[0]?.[1]).not.toHaveProperty("arguments");
  });
});