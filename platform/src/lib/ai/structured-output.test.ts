import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, resolveAiModel, updateOne } = vi.hoisted(() => ({
  create: vi.fn(),
  resolveAiModel: vi.fn(),
  updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        createIndex: vi.fn(),
        insertOne: vi.fn().mockResolvedValue({ insertedId: "trace" }),
        updateOne,
      }),
    }),
  }),
}));
vi.mock("./routing", () => ({ resolveAiModel }));
vi.mock("./providers/registry", () => ({ getProviderClient: () => ({ chat: { completions: { create } } }) }));

import { generateStructuredOutput } from "./structured-output";

describe("generateStructuredOutput transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAiModel.mockResolvedValue({
      provider: "vercel",
      selectedProvider: "vercel",
      model: "deepseek/deepseek-v4-pro",
      inferenceProvider: "deepseek",
      credential: { secret: "secret", source: "test" },
    });
  });

  it("prefers a real native JSON Schema response regardless of catalog metadata", async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: '{"score":9}' } }],
      usage: null,
    });

    const result = await generateRequest();

    expect(result.value).toEqual({ score: 9 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      response_format: expect.objectContaining({ type: "json_schema" }),
    }));
    expect(create.mock.calls[0][0]).not.toHaveProperty("tools");
  });

  it("reads structured arguments from a forced function call", async () => {
    create
      .mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: null } }], usage: null })
      .mockResolvedValueOnce({ choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            type: "function",
            function: { name: "qualification", arguments: '{"score":7}' },
          }],
        },
      }], usage: null });

    const result = await generateRequest();

    expect(result.value).toEqual({ score: 7 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      tool_choice: { type: "function", function: { name: "qualification" } },
      parallel_tool_calls: false,
    }));
  });

  it("retries tools without forced tool_choice when thinking mode rejects it", async () => {
    const thinkingError = Object.assign(new Error("Thinking mode does not support this tool_choice"), { status: 400 });
    create
      .mockResolvedValueOnce({ choices: [{ message: { content: null } }], usage: null })
      .mockRejectedValueOnce(thinkingError)
      .mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{
        type: "function",
        function: { name: "qualification", arguments: '{"score":8}' },
      }] } }], usage: null });

    const result = await generateRequest();

    expect(result.value).toEqual({ score: 8 });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1][0]).toHaveProperty("tool_choice");
    expect(create.mock.calls[2][0]).not.toHaveProperty("tool_choice");
  });

  it("falls back to a forced function call when native output fails semantic validation", async () => {
    create
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"score":"invalid"}' } }],
        usage: null,
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              type: "function",
              function: { name: "qualification", arguments: '{"score":8}' },
            }],
          },
        }],
        usage: null,
      });

    const result = await generateValidatedRequest();

    expect(result.value).toEqual({ score: 8 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toHaveProperty("tool_choice");
  });

  it("doubles the completion budget after a length-truncated response without trying the same fallback", async () => {
    create
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "length", message: { content: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 4_096, total_tokens: 4_196 },
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"score":9}' } }],
        usage: { prompt_tokens: 110, completion_tokens: 20, total_tokens: 130 },
      });

    const result = await generateRequest();

    expect(result.value).toEqual({ score: 9 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].max_completion_tokens).toBe(4_096);
    expect(create.mock.calls[1][0].max_completion_tokens).toBe(8_192);
    expect(create.mock.calls[1][0]).not.toHaveProperty("tools");
  });

  it("retries the structured generation once after invalid native and tool outputs", async () => {
    create
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"score":"invalid"}' } }],
        usage: null,
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              type: "function",
              function: { name: "qualification", arguments: '{"score":"invalid"}' },
            }],
          },
        }],
        usage: null,
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"score":9}' } }],
        usage: null,
      });

    const result = await generateValidatedRequest();

    expect(result.value).toEqual({ score: 9 });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0].messages.at(-1)?.content).toContain("resposta estruturada anterior");
  });

  it("aggregates usage and traces every provider response, including invalid attempts", async () => {
    create
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"score":"invalid"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              type: "function",
              function: { name: "qualification", arguments: '{"score":"invalid"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 },
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '{"score":9}' } }],
        usage: { prompt_tokens: 130, completion_tokens: 13, total_tokens: 143 },
      });

    const result = await generateValidatedRequest();

    expect(result.normalizedUsage).toEqual({
      inputTokens: 350,
      outputTokens: 35,
      totalTokens: 385,
    });
    expect(updateOne.mock.calls.filter(([, update]) => "$push" in update)).toHaveLength(3);
    expect(updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          providerCallCount: 3,
          providerCallsWithUsage: 3,
          normalizedUsage: {
            inputTokens: 350,
            outputTokens: 35,
            totalTokens: 385,
          },
        }),
      }),
    );
  });
});

function generateRequest() {
  return generateStructuredOutput({
    taskKey: "lead_qualification",
    messages: [{ role: "user", content: "Analyze" }],
    schemaName: "qualification",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["score"],
      properties: { score: { type: "number" } },
    },
    parse: JSON.parse,
  });
}

function generateValidatedRequest() {
  return generateStructuredOutput({
    taskKey: "lead_qualification",
    messages: [{ role: "user", content: "Analyze" }],
    schemaName: "qualification",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["score"],
      properties: { score: { type: "number" } },
    },
    parse: (content) => {
      const value = JSON.parse(content) as { score?: unknown };
      if (typeof value.score !== "number") throw new Error("Invalid score.");
      return { score: value.score };
    },
  });
}