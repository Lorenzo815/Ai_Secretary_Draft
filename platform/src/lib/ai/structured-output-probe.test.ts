import { describe, expect, it, vi } from "vitest";
import { probeStructuredOutputClient } from "./structured-output-probe";

function clientWithResponses(...responses: object[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { client: { chat: { completions: { create } } }, create };
}

describe("structured output capability probe", () => {
  it("reports native JSON Schema only after validating its content", async () => {
    const { client, create } = clientWithResponses({
      choices: [{ message: { content: '{"ok":true}' } }],
    });

    await expect(probeStructuredOutputClient(client as never, "vendor/model", "fixed-provider"))
      .resolves.toMatchObject({ mode: "json_schema" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("falls back to a validated forced function call after empty native output", async () => {
    const { client, create } = clientWithResponses(
      { choices: [{ message: { content: null } }] },
      { choices: [{ message: { tool_calls: [{ type: "function", function: { name: "capability_probe", arguments: '{"ok":true}' } }] } }] },
    );

    await expect(probeStructuredOutputClient(client as never, "vendor/model", "fixed-provider"))
      .resolves.toMatchObject({ mode: "tool_call" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not classify provider failures as unsupported", async () => {
    const error = Object.assign(new Error("unauthorized"), { status: 401 });
    const { client } = clientWithResponses();
    client.chat.completions.create.mockRejectedValue(error);

    await expect(probeStructuredOutputClient(client as never, "vendor/model", "fixed-provider"))
      .rejects.toThrow("unauthorized");
  });

  it("validates thinking-mode tools without forcing tool_choice", async () => {
    const thinkingError = Object.assign(new Error("Thinking mode does not support this tool_choice"), { status: 400 });
    const { client, create } = clientWithResponses(
      { choices: [{ message: { content: null } }] },
    );
    create
      .mockRejectedValueOnce(thinkingError)
      .mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{
        type: "function",
        function: { name: "capability_probe", arguments: '{"ok":true}' },
      }] } }] });

    await expect(probeStructuredOutputClient(client as never, "vendor/model", "fixed-provider"))
      .resolves.toMatchObject({ mode: "tool_call" });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0]).not.toHaveProperty("tool_choice");
  });
});