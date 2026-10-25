import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configuration: vi.fn(), process: vi.fn(), forward: vi.fn() }));
vi.mock("@/lib/assistant/agent", () => ({ getAgentConfiguration: mocks.configuration }));
vi.mock("@/lib/automation", () => ({ processNextAutomationJob: mocks.process }));
vi.mock("@/lib/whatsapp/forwarding", () => ({ processForwardingDeliveries: mocks.forward }));
import { POST } from "./route";

function request(authorization?: string) {
  return new Request("https://oria.example/api/internal/assistant/process", {
    method: "POST", headers: authorization ? { authorization } : {},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ASSISTANT_WORKER_SECRET", "worker-secret");
  vi.stubEnv("ASSISTANT_WORKER_BATCH_SIZE", "1");
  mocks.configuration.mockResolvedValue({ enabled: true });
  mocks.process.mockResolvedValue({ processed: true });
  mocks.forward.mockResolvedValue(2);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("independent forwarding worker", () => {
  it.each([undefined, "Bearer invalid", "Basic worker-secret"])("preserves machine authentication for %s", async authorization => {
    expect((await POST(request(authorization))).status).toBe(401);
    expect(mocks.forward).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("drains forwarding deliveries even when AI processing is paused", async () => {
    mocks.configuration.mockResolvedValue({ enabled: false });
    const response = await POST(request("Bearer worker-secret"));
    expect(await response.json()).toMatchObject({ processed: 0, results: [], processingEnabled: false, forwardingProcessed: 2 });
    expect(mocks.forward).toHaveBeenCalledOnce();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("does not make AI processing wait for an unavailable forwarding destination", async () => {
    let complete: (value: number) => void = () => undefined;
    mocks.forward.mockReturnValue(new Promise<number>(resolve => { complete = resolve; }));
    const pending = POST(request("Bearer worker-secret"));
    await vi.waitFor(() => expect(mocks.process).toHaveBeenCalledOnce());
    complete(1);
    expect(await (await pending).json()).toMatchObject({ processed: 1, forwardingProcessed: 1 });
  });
  it("finishes the AI batch before reporting a forwarding database failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.forward.mockRejectedValue(new Error("private database details"));
    let finish: (value: { processed: boolean }) => void = () => undefined;
    mocks.process.mockReturnValue(new Promise<{ processed: boolean }>(resolve => { finish = resolve; }));
    let responded = false;
    const pending = POST(request("Bearer worker-secret")).then(response => { responded = true; return response; });
    await vi.waitFor(() => expect(mocks.process).toHaveBeenCalledOnce());
    expect(responded).toBe(false);
    finish({ processed: true });
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database details");
  });
});
