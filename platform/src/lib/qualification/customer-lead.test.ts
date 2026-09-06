import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireQualificationLock,
  findCustomerById,
  generateStructuredOutput,
  getCustomerProfileSnapshot,
  getLeadQualificationConfiguration,
  listWhatsAppMessagesForAssistant,
  saveCustomerLeadQualification,
} = vi.hoisted(() => ({
  acquireQualificationLock: vi.fn(),
  findCustomerById: vi.fn(),
  generateStructuredOutput: vi.fn(),
  getCustomerProfileSnapshot: vi.fn(),
  getLeadQualificationConfiguration: vi.fn(),
  listWhatsAppMessagesForAssistant: vi.fn(),
  saveCustomerLeadQualification: vi.fn(),
}));

vi.mock("../ai/structured-output", () => ({ generateStructuredOutput }));
vi.mock("../crm", () => ({
  findCustomerById,
  getCustomerProfileSnapshot,
  saveCustomerLeadQualification,
}));
vi.mock("../whatsapp", () => ({ listWhatsAppMessagesForAssistant }));
vi.mock("./config", () => ({ getLeadQualificationConfiguration }));
vi.mock("./lock", () => ({ acquireQualificationLock }));

import { analyzeAndSaveCustomerLeadQualification } from "./customer-lead";
import { buildQualificationSourceHash } from "./source-hash";

beforeEach(() => vi.clearAllMocks());

describe("qualification source hash", () => {
  it("changes when the active prompt configuration changes", () => {
    const input = { conversation: [{ direction: "inbound", text: "Olá" }] };

    expect(buildQualificationSourceHash(input, "config-a"))
      .not.toBe(buildQualificationSourceHash(input, "config-b"));
  });

  it("is stable for the same input and configuration", () => {
    const input = { conversation: [{ direction: "inbound", text: "Olá" }] };

    expect(buildQualificationSourceHash(input, "config-a"))
      .toBe(buildQualificationSourceHash(input, "config-a"));
  });

  it("returns the stored analysis without calling AI when the source is unchanged", async () => {
    const customerId = new (await import("mongodb")).ObjectId();
    const contentHash = "config-a";
    const sourceHash = buildQualificationSourceHash({
      clinicCity: "Ponta Grossa/PR",
      customerLocation: { neighborhood: null, city: null, state: null },
      ageYears: null,
      profession: null,
      conversation: [],
    }, contentHash);
    const storedQualification = { version: 5, sourceHash };
    findCustomerById.mockResolvedValue({ leadQualification: storedQualification });
    getCustomerProfileSnapshot.mockReturnValue({ birthDate: null, profession: null, address: null });
    getLeadQualificationConfiguration.mockResolvedValue({ enabled: true, contentHash });
    listWhatsAppMessagesForAssistant.mockResolvedValue([]);

    await expect(analyzeAndSaveCustomerLeadQualification(customerId))
      .resolves.toBe(storedQualification);
    expect(generateStructuredOutput).not.toHaveBeenCalled();
    expect(acquireQualificationLock).not.toHaveBeenCalled();
    expect(saveCustomerLeadQualification).not.toHaveBeenCalled();
  });
});