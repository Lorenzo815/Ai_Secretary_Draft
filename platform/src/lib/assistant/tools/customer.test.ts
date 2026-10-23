import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "./contracts";
import { createDefaultAgentConfiguration } from "../agent/defaults";
import type { AgentConfigurationDocument } from "../agent/contracts";

const { updateCustomerProfile, classifyCustomerRelationship, getCustomerProfileSnapshot } = vi.hoisted(() => ({
  updateCustomerProfile: vi.fn(),
  classifyCustomerRelationship: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
}));

vi.mock("../../crm", () => ({
  CustomerProfileValidationError: class CustomerProfileValidationError extends Error {},
  classifyCustomerRelationship,
  getCustomerProfileSnapshot,
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

  describe.each(["classify_relationship", "update_profile"] as const)("configured routing through %s", tool => {
    let context: ToolExecutionContext;

    beforeEach(() => {
      vi.resetAllMocks();
      context = {
        customerId: new ObjectId(), customerName: "Customer", contactPhone: "",
        configuration: createDefaultAgentConfiguration(),
      };
      getCustomerProfileSnapshot.mockReturnValue({ missingFields: [] });
      classifyCustomerRelationship.mockResolvedValue({ serviceStatus: "human_active" });
      updateCustomerProfile.mockResolvedValue({ serviceStatus: "human_active" });
    });

    describe.each(["new", "returning"] as const)("%s", status => {
      it.each(["preserve", "ai_active", "waiting_human"] as const)("uses the pinned %s action rather than assuming a route", async action => {
        context.configuration.relationshipRouting[status] = action;
        context.configuration.relationshipRouting[status === "new" ? "returning" : "new"] = "waiting_human";
        const customer = { serviceStatus: action === "preserve" ? "human_active" : action };
        classifyCustomerRelationship.mockResolvedValue(customer);
        updateCustomerProfile.mockResolvedValue(customer);

        const result = await executeRegisteredCustomerTool(tool, context, tool === "classify_relationship"
          ? { status, confirmedByCustomer: true }
          : { relationshipStatus: status, relationshipConfirmedByCustomer: true });
        const options = action === "preserve" ? {} : { serviceStatus: action };

        expect(JSON.parse(result.output)).toMatchObject({ ok: true, serviceStatus: customer.serviceStatus });
        if (tool === "classify_relationship") {
          expect(classifyCustomerRelationship).toHaveBeenCalledWith(context.customerId, status, options);
        } else {
          expect(updateCustomerProfile).toHaveBeenCalledWith(context.customerId, expect.objectContaining({ relationshipStatus: status }), options);
        }
      });
    });

    it("defaults legacy pinned configurations to preserving the current handler", async () => {
      delete (context.configuration as Partial<AgentConfigurationDocument>).relationshipRouting;

      await executeRegisteredCustomerTool(tool, context, tool === "classify_relationship"
        ? { status: "returning", confirmedByCustomer: true }
        : { relationshipStatus: "returning", relationshipConfirmedByCustomer: true });

      const calls = tool === "classify_relationship" ? classifyCustomerRelationship.mock.calls : updateCustomerProfile.mock.calls;
      expect(calls[0][2]).toEqual({});
    });

    it("does not route without the customer's explicit classification response", async () => {
      context.configuration.relationshipRouting.returning = "waiting_human";
      const result = await executeRegisteredCustomerTool(tool, context, tool === "classify_relationship"
        ? { status: "returning", confirmedByCustomer: false }
        : { relationshipStatus: "returning", relationshipConfirmedByCustomer: false });

      expect(JSON.parse(result.output)).toMatchObject({ ok: false, type: "validation_error" });
      expect(classifyCustomerRelationship).not.toHaveBeenCalled();
      expect(updateCustomerProfile).not.toHaveBeenCalled();
    });
  });
});