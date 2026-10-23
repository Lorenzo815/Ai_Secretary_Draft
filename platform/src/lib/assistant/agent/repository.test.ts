import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentConfiguration } from "./defaults";
import type { AgentConfigurationDocument } from "./contracts";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  replaceOne: vi.fn(),
  getCalendarSettings: vi.fn(),
}));

vi.mock("../../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection: () => mocks }) }),
}));
vi.mock("../../calendar/calendar", () => ({ getCalendarSettings: mocks.getCalendarSettings }));
vi.mock("../tools", () => ({ isAssistantToolKey: () => true }));

import { getAgentConfiguration, setAgentEnabled, updateAgentConfiguration, updateAgentPaymentSettings } from "./repository";

describe("partial agent payment settings", () => {
  let current: AgentConfigurationDocument;

  beforeEach(() => {
    vi.clearAllMocks();
    current = createDefaultAgentConfiguration();
    current.payment = { pixKey: "original-key", recipientName: "Clinic", signalAmountCents: 12_345 };
    mocks.findOne.mockImplementation(async () => current);
    mocks.replaceOne.mockImplementation(async (_filter, next: AgentConfigurationDocument) => {
      current = next;
      return { matchedCount: 1 };
    });
    mocks.getCalendarSettings.mockResolvedValue({
      eventTypes: current.bookableEventTypeKeys.map((key) => ({ key })),
    });
  });

  it("changes the amount without changing manual Pix details or other agent settings", async () => {
    const identityPrompt = current.identityPrompt;
    const saved = await updateAgentPaymentSettings({ signalAmountCents: 25_000 });

    expect(saved.payment).toEqual({ pixKey: "original-key", recipientName: "Clinic", signalAmountCents: 25_000 });
    expect(saved.identityPrompt).toBe(identityPrompt);
    expect((await getAgentConfiguration()).payment).toEqual(saved.payment);
    expect(saved.revision).toBe(2);
  });

  it("preserves a newer amount when manual Pix details are subsequently saved", async () => {
    await updateAgentPaymentSettings({ signalAmountCents: 25_000 });
    const saved = await updateAgentPaymentSettings({ pixKey: " new-key ", recipientName: " New Clinic " });

    expect(saved.payment).toEqual({ pixKey: "new-key", recipientName: "New Clinic", signalAmountCents: 25_000 });
    expect((await getAgentConfiguration()).payment).toEqual(saved.payment);
  });

  it("preserves newer manual details when the amount is subsequently saved", async () => {
    await updateAgentPaymentSettings({ pixKey: "new-key", recipientName: "New Clinic" });
    const saved = await updateAgentPaymentSettings({ signalAmountCents: 25_000 });

    expect(saved.payment).toEqual({ pixKey: "new-key", recipientName: "New Clinic", signalAmountCents: 25_000 });
  });

  it("keeps the existing key when the manual form leaves it blank", async () => {
    const saved = await updateAgentPaymentSettings({ pixKey: "   ", recipientName: "New Clinic" });

    expect(saved.payment).toEqual({ pixKey: "original-key", recipientName: "New Clinic", signalAmountCents: 12_345 });
  });

  it("allows changing the amount without configuring manual Pix", async () => {
    current.payment = { pixKey: "", recipientName: "", signalAmountCents: 10_000 };

    expect((await updateAgentPaymentSettings({ signalAmountCents: 25_000 })).payment)
      .toEqual({ pixKey: "", recipientName: "", signalAmountCents: 25_000 });
  });

  it.each([100, 1_000_000])("accepts a boundary amount of %i cents", async (signalAmountCents) => {
    expect((await updateAgentPaymentSettings({ signalAmountCents })).payment.signalAmountCents).toBe(signalAmountCents);
  });

  it.each([0, 99, 1_000_001, 100.5, Number.NaN])("rejects an invalid amount of %s cents", async (signalAmountCents) => {
    await expect(updateAgentPaymentSettings({ signalAmountCents })).rejects.toThrow("O valor do sinal");
    expect(mocks.replaceOne).not.toHaveBeenCalled();
  });

  it("reports concurrent configuration changes instead of overwriting them", async () => {
    mocks.replaceOne.mockResolvedValue({ matchedCount: 0 });

    await expect(updateAgentPaymentSettings({ signalAmountCents: 25_000 }))
      .rejects.toThrow("A configura\u00e7\u00e3o foi alterada por outra sess\u00e3o.");
  });

  it("preserves the registered appointment lookup instead of migrating it to slot search", async () => {
    current.enabledTools = ["calendar.list_appointments"];
    current.toolGuidance = { "calendar.list_appointments": "Use for existing appointments." };

    const loaded = await getAgentConfiguration();

    expect(loaded.enabledTools).toEqual(["calendar.list_appointments"]);
    expect(loaded.toolGuidance).toEqual(current.toolGuidance);
    expect(mocks.replaceOne).not.toHaveBeenCalled();
  });

  it("does not silently grant the new tool to existing configurations", async () => {
    current.enabledTools = [];

    expect((await getAgentConfiguration()).enabledTools).toEqual([]);
    expect(mocks.replaceOne).not.toHaveBeenCalled();
  });

  it("migrates missing relationship routing without changing other settings or repeatedly migrating", async () => {
    delete (current as Partial<AgentConfigurationDocument>).relationshipRouting;
    const before = { ...current };

    const saved = await getAgentConfiguration();

    expect(saved).toEqual({
      ...before, relationshipRouting: { new: "preserve", returning: "preserve" },
      revision: before.revision + 1, contentHash: expect.any(String), updatedAt: expect.any(Date), updatedBy: "system-migration",
    });
    expect((await getAgentConfiguration()).relationshipRouting).toEqual(saved.relationshipRouting);
    expect(mocks.replaceOne).toHaveBeenCalledOnce();
  });

  it("persists independent routing choices, includes them in the hash and preserves them in partial saves", async () => {
    const originalHash = current.contentHash;
    const saved = await updateAgentConfiguration({
      expectedRevision: current.revision, updatedBy: "test",
      configuration: { ...current, relationshipRouting: { new: "ai_active", returning: "waiting_human" } },
    });
    expect(saved.contentHash).not.toBe(originalHash);
    expect((await getAgentConfiguration()).relationshipRouting).toEqual({ new: "ai_active", returning: "waiting_human" });
    await updateAgentPaymentSettings({ signalAmountCents: 25_000 });
    await setAgentEnabled(false);
    expect(current.relationshipRouting).toEqual(saved.relationshipRouting);
  });

  it("does not reset explicit existing routing choices on read", async () => {
    current.relationshipRouting = { new: "waiting_human", returning: "ai_active" };

    expect((await getAgentConfiguration()).relationshipRouting).toEqual(current.relationshipRouting);
    expect(mocks.replaceOne).not.toHaveBeenCalled();
  });

  it.each([null, false, [], {}, { new: "preserve" }, { new: "preserve", returning: "human_active" }, { new: "preserve", returning: "preserve", other: "waiting_human" }])(
    "rejects invalid relationship routing %j without saving",
    async value => {
      await expect(updateAgentConfiguration({
        expectedRevision: current.revision, updatedBy: "test",
        configuration: { ...current, relationshipRouting: JSON.parse(JSON.stringify(value)) },
      })).rejects.toThrow(/roteamento/i);
      expect(mocks.replaceOne).not.toHaveBeenCalled();
    },
  );

  it("uses the concurrent policy rather than reverting it when migration loses a revision race", async () => {
    delete (current as Partial<AgentConfigurationDocument>).relationshipRouting;
    const concurrent = { ...current, revision: 3, relationshipRouting: { new: "ai_active", returning: "waiting_human" } };
    mocks.findOne.mockResolvedValueOnce(current).mockResolvedValueOnce(concurrent);
    mocks.replaceOne.mockResolvedValueOnce({ matchedCount: 0 });

    expect((await getAgentConfiguration()).relationshipRouting).toEqual(concurrent.relationshipRouting);
  });
});
