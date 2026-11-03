import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paused: vi.fn(), process: vi.fn(), forward: vi.fn(), echoes: vi.fn(), templates: vi.fn() }));
vi.mock("@/lib/assistant/agent", () => ({ listPausedAgentCompanyIds: mocks.paused }));
vi.mock("@/lib/automation", () => ({ processNextAutomationJob: mocks.process }));
vi.mock("@/lib/whatsapp/forwarding", () => ({ processForwardingDeliveries: mocks.forward }));
vi.mock("@/lib/whatsapp/message-echoes", () => ({ processPendingWhatsAppMessageEchoes: mocks.echoes }));
vi.mock("@/lib/whatsapp/templates", () => ({ refreshWhatsAppTemplateCatalog: mocks.templates }));
vi.mock("@/lib/confirmations/service", () => ({ applyAttendanceAfterPayment: vi.fn(async () => "pending"), getOpenConfirmationForCustomer: vi.fn(async () => null), handleConfirmationButton: vi.fn(async () => ({ handled: false })), processAppointmentConfirmations: vi.fn(async () => ({ skipped: true })) }));
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
  mocks.paused.mockResolvedValue([]);
  mocks.process.mockResolvedValue({ processed: true });
  mocks.forward.mockResolvedValue(2);
  mocks.echoes.mockResolvedValue({ processed: 3, failed: 0, pending: false });
  mocks.templates.mockResolvedValue({ configured: true, count: 5 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("independent forwarding worker", () => {
  it.each([undefined, "Bearer invalid", "Basic worker-secret"])("preserves machine authentication for %s", async authorization => {
    expect((await POST(request(authorization))).status).toBe(401);
    expect(mocks.forward).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.echoes).not.toHaveBeenCalled();
    expect(mocks.templates).not.toHaveBeenCalled();
  });
  it("drains forwarding deliveries and leaves paused companies' jobs queued", async () => {
    const paused = [new ObjectId()];
    mocks.paused.mockResolvedValue(paused);
    mocks.process.mockResolvedValue({ processed: false });
    const response = await POST(request("Bearer worker-secret"));
    expect(await response.json()).toMatchObject({
      processed: 0, results: [], pausedCompanies: 1, forwardingProcessed: 2,
      echoesProcessed: 3, echoSyncFailures: 0,
    });
    expect(mocks.forward).toHaveBeenCalledOnce();
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith({ excludeCompanyIds: paused });
    expect(mocks.echoes).toHaveBeenCalledOnce();
    expect(mocks.templates).toHaveBeenCalledOnce();
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
  it("reconciles archived echoes before starting AI processing", async () => {
    const response = await POST(request("Bearer worker-secret"));
    expect(response.status).toBe(200);
    expect(mocks.echoes.mock.invocationCallOrder[0]).toBeLessThan(mocks.process.mock.invocationCallOrder[0]);
  });
  it("reports pending synchronization failures explicitly without exposing their contents", async () => {
    mocks.echoes.mockResolvedValue({ processed: 2, failed: 1, pending: true });
    const response = await POST(request("Bearer worker-secret"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ echoesProcessed: 2, echoSyncFailures: 1 });
  });
  it("does not make AI processing wait for a template catalog refresh", async () => {
    let finish: (value: { configured: boolean; count: number }) => void = () => undefined;
    mocks.templates.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = POST(request("Bearer worker-secret"));
    await vi.waitFor(() => expect(mocks.process).toHaveBeenCalledOnce());
    finish({ configured: true, count: 6 });
    expect(await (await pending).json()).toMatchObject({ processed: 1, templateCatalog: { configured: true, count: 6 } });
  });
  it("finishes other tasks and reports catalog failures without disclosing provider errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.templates.mockRejectedValue(new Error("private token and catalog details"));
    const response = await POST(request("Bearer worker-secret"));
    expect(response.status).toBe(503);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.forward).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain("private token");
  });
});
