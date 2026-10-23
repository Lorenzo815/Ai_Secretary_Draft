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

import { getAgentConfiguration, updateAgentPaymentSettings } from "./repository";

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
});
