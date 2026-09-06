import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationJobDocument } from "./contracts";

const {
  analyzeAndSaveCustomerLeadQualification,
  claimAutomationJob,
  completeAutomationJob,
  processCustomerAgentJob,
} = vi.hoisted(() => ({
  analyzeAndSaveCustomerLeadQualification: vi.fn(),
  claimAutomationJob: vi.fn(),
  completeAutomationJob: vi.fn(),
  processCustomerAgentJob: vi.fn(),
}));

vi.mock("../assistant/config", () => ({ getAssistantConfig: () => ({ leaseMs: 60_000 }) }));
vi.mock("../assistant/agent/orchestrator", () => ({ processCustomerAgentJob }));
vi.mock("../qualification/customer-lead", () => ({ analyzeAndSaveCustomerLeadQualification }));
vi.mock("./queue", () => ({
  claimAutomationJob,
  completeAutomationJob,
  failAutomationJob: vi.fn(),
}));

import { processNextAutomationJob } from "./processor";

describe("automation processor qualification routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discards qualification jobs that were not created by a processed follow-up", async () => {
    const job = createQualificationJob("customer.profile.updated");
    claimAutomationJob.mockResolvedValue(job);

    const result = await processNextAutomationJob();

    expect(analyzeAndSaveCustomerLeadQualification).not.toHaveBeenCalled();
    expect(completeAutomationJob).toHaveBeenCalledWith(job._id, job.revision);
    expect(result).toMatchObject({ skipped: "not_follow_up_qualification" });
  });

  it("runs qualification for a job created after a follow-up response", async () => {
    const job = createQualificationJob("assistant.response.sent", { reason: "follow_up" });
    claimAutomationJob.mockResolvedValue(job);
    analyzeAndSaveCustomerLeadQualification.mockResolvedValue({ version: 5 });

    await processNextAutomationJob();

    expect(analyzeAndSaveCustomerLeadQualification).toHaveBeenCalledWith(job.customerId);
    expect(completeAutomationJob).toHaveBeenCalledWith(job._id, job.revision);
  });
});

function createQualificationJob(
  event: AutomationJobDocument["event"],
  eventPayload?: Record<string, unknown>,
): AutomationJobDocument {
  const now = new Date();
  return {
    _id: new ObjectId(),
    process: "lead_qualification",
    customerId: new ObjectId(),
    event,
    eventPayload,
    status: "processing",
    revision: 1,
    dueAt: now,
    latestEventAt: now,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
}