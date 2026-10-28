import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationJobDocument } from "../../automation/contracts";
import type { AgentFinalResponse } from "./contracts";
import { createDefaultAgentConfiguration } from "./defaults";

const mocks = vi.hoisted(() => ({
  customer: vi.fn(), status: vi.fn(), send: vi.fn(), latestInbound: vi.fn(), saveMessage: vi.fn(), external: vi.fn(), sync: vi.fn(),
  complete: vi.fn(), defer: vi.fn(), fail: vi.fn(), current: vi.fn(), eligibility: vi.fn(), schedule: vi.fn(), qualification: vi.fn(),
  context: vi.fn(), saveContext: vi.fn(), generate: vi.fn(), configuration: vi.fn(), runtime: vi.fn(), checkpoint: vi.fn(),
  start: vi.fn(), finish: vi.fn(), step: vi.fn(), execute: vi.fn(),
}));
vi.mock("../../crm", () => ({ findCustomerById: mocks.customer, updateCustomerServiceStatus: mocks.status }));
vi.mock("../../whatsapp/client", () => ({ sendTextMessage: mocks.send }));
vi.mock("../../whatsapp/messages", () => ({
  isLatestInboundWhatsAppMessage: mocks.latestInbound, saveWhatsAppMessage: mocks.saveMessage,
  getWhatsAppExternalActivityState: mocks.external,
}));
vi.mock("../../whatsapp/message-echoes", () => ({ processPendingWhatsAppMessageEchoes: mocks.sync }));
vi.mock("../../automation/queue", () => ({
  claimAutomationJob: vi.fn(), completeAutomationJob: mocks.complete, deferAutomationJob: mocks.defer,
  failAutomationJob: mocks.fail, isAutomationJobCurrent: mocks.current,
}));
vi.mock("../../follow-up/service", () => ({
  getCustomerFollowUpEligibility: mocks.eligibility, getAutomationJobFollowUpAttempt: () => 1,
  scheduleFollowUpQualification: mocks.qualification, scheduleNextCustomerFollowUp: mocks.schedule,
}));
vi.mock("../context", () => ({ loadAssistantContext: mocks.context, saveAssistantContext: mocks.saveContext }));
vi.mock("../config", () => ({ getAssistantConfig: () => ({ recentMessageLimit: 40 }) }));
vi.mock("../tools/execution", () => ({ getGroundedToolReply: () => null, wasToolSuccessfullyExecuted: () => false }));
vi.mock("./model", () => ({ generateAgentAction: mocks.generate }));
vi.mock("./repository", () => ({ getAgentConfiguration: mocks.configuration }));
vi.mock("./runtime-context", () => ({ buildAgentRuntimeContext: mocks.runtime }));
vi.mock("./runs", () => ({
  fingerprintAgentToolRequest: () => "tool-1", finishAgentRun: mocks.finish, loadAgentRunCheckpoint: mocks.checkpoint,
  recordAgentRunStep: mocks.step, startAgentRun: mocks.start,
}));
vi.mock("./tool-policy", () => ({ executeAgentTool: mocks.execute }));

import { processCustomerAgentJob } from "./orchestrator";

const customerId = new ObjectId();
const inboundAt = new Date("2026-10-25T18:00:00Z");
function job(process: AutomationJobDocument["process"] = "customer_agent"): AutomationJobDocument {
  return {
    _id: new ObjectId(), customerId, process, event: "message.received", status: "processing", revision: 1,
    dueAt: inboundAt, latestEventAt: inboundAt, consecutiveFailures: 0, createdAt: inboundAt, updatedAt: inboundAt,
  };
}
const final: AgentFinalResponse = {
  type: "final", decision: "reply", message: "Resposta da Oria", groundingResultIds: [],
  memory: { summary: "Summary", pendingQuestion: null, nonSensitiveFacts: [] },
};
function manualReply() {
  mocks.external.mockResolvedValue({ version: "manual-1", latestAt: new Date(inboundAt.getTime() + 1_000) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.customer.mockResolvedValue({ _id: customerId, name: "Customer", phones: ["5511999999999"], serviceStatus: "ai_active" });
  mocks.configuration.mockResolvedValue({ ...createDefaultAgentConfiguration(), enabled: true });
  mocks.sync.mockResolvedValue({ processed: 0, failed: 0, pending: false });
  mocks.external.mockResolvedValue({ version: "initial", latestAt: null });
  mocks.context.mockResolvedValue({
    summary: "Summary", pendingQuestion: null, nonSensitiveFacts: [],
    messages: [{
      _id: new ObjectId(), customerId, direction: "inbound", timestamp: inboundAt,
      contactPhone: "5511999999999", contactName: "Customer", type: "text", body: "Question",
    }],
  });
  mocks.current.mockResolvedValue(true);
  mocks.latestInbound.mockResolvedValue(true);
  mocks.checkpoint.mockResolvedValue({
    modelIterations: 0, toolExecutions: 0, mutationsExecuted: 0, toolHistory: [], toolResultsByFingerprint: new Map(),
  });
  mocks.start.mockResolvedValue({ _id: new ObjectId() });
  mocks.runtime.mockResolvedValue({ operations: { activeSchedulingOption: null } });
  mocks.generate.mockResolvedValue({ value: structuredClone(final) });
  mocks.send.mockResolvedValue({ messageId: "wamid.oria" });
  mocks.eligibility.mockResolvedValue({ eligible: true, instructions: "Follow up", attempt: 1 });
});

describe("AI appointment client names", () => {
  it.each(["calendar.hold", "calendar.book"])("passes the refreshed CRM name to %s rather than the WhatsApp or profile name", async (tool) => {
    const customer = {
      _id: customerId,
      name: "Current CRM name",
      phones: ["5511999999999"],
      serviceStatus: "ai_active",
      profile: { fullName: "Different full name" },
    };
    mocks.customer.mockResolvedValueOnce({ ...customer, name: "Previous CRM name" }).mockResolvedValue(customer);
    mocks.generate
      .mockResolvedValueOnce({
        value: { type: "tool_request", reasonCode: "need_authoritative_data", toolCall: { tool, arguments: {} } },
      })
      .mockResolvedValueOnce({ value: final });
    mocks.execute.mockResolvedValue({ output: "{}", mutation: false, retryable: false });

    await processCustomerAgentJob(job());

    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      context: expect.objectContaining({ customerId, customerName: "Current CRM name" }),
    }));
  });
});

describe("AI synchronization with external WhatsApp replies", () => {
  it("reconciles echoes before reading AI history", async () => {
    expect(await processCustomerAgentJob(job())).toMatchObject({ decision: "reply" });
    expect(mocks.sync.mock.invocationCallOrder[0]).toBeLessThan(mocks.context.mock.invocationCallOrder[0]);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(["customer_agent", "customer_follow_up"] as const)("skips a queued %s after a manual reply without changing service status", async process => {
    manualReply();
    expect(await processCustomerAgentJob(job(process))).toMatchObject({ skipped: "manual_reply_received" });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledOnce();
  });

  it("cancels the generated response if a manual reply arrives while the model is running", async () => {
    mocks.generate.mockImplementation(async () => { manualReply(); return { value: final }; });
    expect(await processCustomerAgentJob(job())).toMatchObject({ skipped: "manual_reply_received" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.saveContext).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "superseded" }));
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("denies business-changing tools after a manual reply arrives", async () => {
    mocks.generate.mockImplementation(async () => {
      manualReply();
      return { value: { type: "tool_request", reasonCode: "need_authoritative_data", toolCall: { tool: "calendar.book", arguments: { candidateId: "candidate" } } } };
    });
    const mutation = vi.fn();
    mocks.execute.mockImplementation(async (input: { context: { isMutationAllowed: () => Promise<boolean> } }) => {
      if (await input.context.isMutationAllowed()) mutation();
      return { output: "{}", mutation: false, retryable: false };
    });
    expect(await processCustomerAgentJob(job())).toMatchObject({ skipped: "manual_reply_received" });
    expect(mutation).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("resumes normally for the next customer message, including the manual response in context", async () => {
    mocks.external.mockResolvedValue({ version: "manual-1", latestAt: new Date(inboundAt.getTime() - 1_000) });
    expect(await processCustomerAgentJob(job())).toMatchObject({ decision: "reply" });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("defers instead of replying if late older history changes while generating", async () => {
    mocks.generate.mockImplementation(async () => {
      mocks.external.mockResolvedValue({ version: "late-older-message", latestAt: new Date(inboundAt.getTime() - 10_000) });
      return { value: final };
    });
    expect(await processCustomerAgentJob(job())).toMatchObject({ skipped: "conversation_changed" });
    expect(mocks.defer).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("defers jobs while matching archived events still need synchronization", async () => {
    mocks.sync.mockResolvedValue({ processed: 100, failed: 1, pending: true });
    expect(await processCustomerAgentJob(job())).toMatchObject({ skipped: "whatsapp_sync_pending" });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.defer).toHaveBeenCalledOnce();
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("retains the existing latest-inbound safeguard", async () => {
    mocks.latestInbound.mockResolvedValue(false);
    expect(await processCustomerAgentJob(job())).toMatchObject({ skipped: "newer_message_arrived" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
