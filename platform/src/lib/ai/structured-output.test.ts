import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, resolveAiModel } = vi.hoisted(() => ({
  create: vi.fn(),
  resolveAiModel: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        createIndex: vi.fn(),
        insertOne: vi.fn().mockResolvedValue({ insertedId: "trace" }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
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