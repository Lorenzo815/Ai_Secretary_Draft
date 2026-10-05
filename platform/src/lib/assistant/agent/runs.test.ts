import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAction, AgentRunDocument, AgentRunStepDocument } from "./contracts";

const {
  collection,
  createIndex,
  insertOne,
  runFind,
  runFindForReconciliation,
  runsToArray,
  stepFind,
  stepsToArray,
  updateMany,
} = vi.hoisted(() => ({
  collection: vi.fn(),
  createIndex: vi.fn(),
  insertOne: vi.fn(),
  runFind: vi.fn(),
  runFindForReconciliation: vi.fn(),
  runsToArray: vi.fn(),
  stepFind: vi.fn(),
  stepsToArray: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("../../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection }) }),
}));

import {
  buildAgentRunCheckpoint,
  fingerprintAgentToolRequest,
  loadAgentRunCheckpoint,
  reconcileResumedAgentRuns,
  startAgentRun,
} from "./runs";
import { createDefaultAgentConfiguration } from "./defaults";

describe("agent run checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runFind.mockReturnValue({ sort: () => ({ toArray: runsToArray }) });
    stepFind.mockReturnValue({ sort: () => ({ toArray: stepsToArray }) });
    updateMany.mockResolvedValue({ modifiedCount: 0 });
    collection.mockImplementation((name: string) => name === "assistant_runs"
      ? { createIndex, find: runFind, insertOne, updateMany }
      : { find: stepFind });
  });

  it("deduplicates completed tools and preserves cumulative budgets", () => {
    const firstRun = createRun({ modelIterations: 2, toolExecutions: 1, mutationsExecuted: 1 });
    const secondRun = createRun({ modelIterations: 4, toolExecutions: 2, mutationsExecuted: 1 });
    const request = createProfileRequest("12345678900");
    const fingerprint = fingerprintAgentToolRequest(request);
    const redactedRequest = createProfileRequest("[REDACTED]");
    expect(fingerprintAgentToolRequest(redactedRequest)).toBe(fingerprint);
    const firstStep = createStep(firstRun._id, redactedRequest, {
      resultId: "first-result",
      result: successfulResult("customer.update_profile"),
      fingerprint,
      mutation: true,
      retryable: false,
    });
    const repeatedStep = createStep(secondRun._id, redactedRequest, {
      resultId: "latest-result",
      result: successfulResult("customer.update_profile"),
      fingerprint,
      retryable: false,
    });
    const retryableStep = createStep(secondRun._id, createProfileRequest("other"), {
      resultId: "invalid-result",
      result: failedResult("customer.update_profile"),
      retryable: true,
    });
    const historicalOperationalStep = createStep(secondRun._id, createProfileRequest("legacy"), {
      resultId: "operational-result",
      result: failedResult("customer.update_profile"),
      retryable: false,
    });

    const checkpoint = buildAgentRunCheckpoint(
      [firstRun, secondRun],
      [firstStep, repeatedStep, retryableStep, historicalOperationalStep],
    );


function successfulResult(tool: string) {
  return { executedTools: [tool], results: [{ ok: true }] };
}

function failedResult(tool: string) {
  return { executedTools: [tool], results: [{ ok: false, type: "operational_error" }] };
}
    expect(checkpoint.toolHistory).toHaveLength(1);
    expect(checkpoint.toolResultsByFingerprint.get(fingerprint)?.resultId).toBe("latest-result");
    expect(checkpoint).toMatchObject({ modelIterations: 4, toolExecutions: 2, mutationsExecuted: 1 });
  });

  it("loads only the current job revision and configuration hash", async () => {
    runsToArray.mockResolvedValue([]);
    const customerId = new ObjectId();

    const checkpoint = await loadAgentRunCheckpoint({
      customerId,
      jobRevision: 8,
      configHash: "current-config",
    });

    expect(runFind).toHaveBeenCalledWith({
      customerId,
      jobRevision: 8,
      configHash: "current-config",
      status: { $in: ["failed", "running"] },
    });
    expect(stepFind).not.toHaveBeenCalled();
    expect(checkpoint.toolHistory).toEqual([]);
  });

  it("supersedes interrupted runs before starting a resumed run", async () => {
    const interruptedRunId = new ObjectId();
    const customerId = new ObjectId();
    const configuration = createDefaultAgentConfiguration();

    await startAgentRun({
      customerId,
      jobRevision: 8,
      configuration,
      checkpoint: {
        runIds: [interruptedRunId],
        toolHistory: [],
        toolResultsByFingerprint: new Map(),
        modelIterations: 1,
        toolExecutions: 1,
        mutationsExecuted: 0,
      },
    });

    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: [interruptedRunId] }, status: "running" },
      { $set: { status: "superseded", completedAt: expect.any(Date) } },
    );
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      status: "running",
      resumedFromRunIds: [interruptedRunId],
    }));
  });

  it("reconciles already orphaned runs referenced by resumed executions", async () => {
    const interruptedRunId = new ObjectId();
    runFindForReconciliation.mockResolvedValue([{ resumedFromRunIds: [interruptedRunId] }]);
    runFind.mockReturnValueOnce({ toArray: runFindForReconciliation });
    updateMany.mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(reconcileResumedAgentRuns()).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: [interruptedRunId] }, status: "running" },
      { $set: { status: "superseded", completedAt: expect.any(Date) } },
    );
  });
});

function createRun(counters: Pick<AgentRunDocument, "modelIterations" | "toolExecutions" | "mutationsExecuted">) {
  return {
    _id: new ObjectId(),
    customerId: new ObjectId(),
    jobRevision: 7,
    configRevision: 3,
    configHash: "config-hash",
    configSnapshot: {} as AgentRunDocument["configSnapshot"],
    status: "failed",
    ...counters,
    startedAt: new Date(),
  } satisfies AgentRunDocument;
}

function createProfileRequest(cpf: string) {
  return {
    type: "tool_request",
    reasonCode: "persist_customer_data",
    toolCall: { tool: "customer.update_profile", arguments: { cpf } },
  } satisfies Extract<AgentAction, { type: "tool_request" }>;
}

function createStep(
  runId: ObjectId,
  action: Extract<AgentAction, { type: "tool_request" }>,
  toolResult: NonNullable<AgentRunStepDocument["toolResult"]>,
) {
  return {
    _id: new ObjectId(),
    runId,
    customerId: new ObjectId(),
    iteration: 1,
    action,
    toolResult,
    createdAt: new Date(),
  } satisfies AgentRunStepDocument;
}