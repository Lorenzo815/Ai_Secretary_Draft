import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchAndTranscribeWhatsAppAudio,
  fetchWhatsAppImageDataUrl,
  findOne,
  listWhatsAppMessagesForAssistant,
  updateWhatsAppMediaTranscription,
} = vi.hoisted(() => ({
  fetchAndTranscribeWhatsAppAudio: vi.fn(),
  fetchWhatsAppImageDataUrl: vi.fn(),
  findOne: vi.fn(),
  listWhatsAppMessagesForAssistant: vi.fn(),
  updateWhatsAppMediaTranscription: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection: () => ({ findOne }) }) }),
}));
vi.mock("../whatsapp/client", () => ({ fetchWhatsAppImageDataUrl }));
vi.mock("../whatsapp/audio", () => ({ fetchAndTranscribeWhatsAppAudio }));
vi.mock("../whatsapp/messages", () => ({
  listWhatsAppMessagesForAssistant,
  updateWhatsAppMediaTranscription,
}));

import { loadAssistantContext } from "./context";

describe("assistant audio context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOne.mockResolvedValue(null);
    updateWhatsAppMediaTranscription.mockResolvedValue(undefined);
  });

  it("transcribes an inbound audio once and persists it for later runs", async () => {
    const customerId = new ObjectId();
    const message = {
      _id: new ObjectId(),
      customerId,
      metaMessageId: "wamid.audio",
      contactPhone: "5511999999999",
      direction: "inbound",
      type: "audio",
      body: "[audio]",
      media: { id: "audio-123", mimeType: "audio/ogg" },
      status: "received",
      timestamp: new Date(),
      updatedAt: new Date(),
    };
    listWhatsAppMessagesForAssistant.mockResolvedValue([message]);
    fetchAndTranscribeWhatsAppAudio.mockResolvedValue("Quero agendar uma consulta.");

    const context = await loadAssistantContext(customerId, 40);

    expect(context.messages[0].media?.transcription).toBe("Quero agendar uma consulta.");
    expect(fetchAndTranscribeWhatsAppAudio).toHaveBeenCalledWith("audio-123");
    expect(updateWhatsAppMediaTranscription).toHaveBeenCalledWith(
      "wamid.audio",
      "Quero agendar uma consulta.",
    );
  });

  it("does not transcribe audio that already has a stored transcription", async () => {
    const customerId = new ObjectId();
    listWhatsAppMessagesForAssistant.mockResolvedValue([{
      _id: new ObjectId(),
      customerId,
      metaMessageId: "wamid.audio",
      contactPhone: "5511999999999",
      direction: "inbound",
      type: "audio",
      body: "[audio]",
      media: { id: "audio-123", mimeType: "audio/ogg", transcription: "Texto existente." },
      status: "received",
      timestamp: new Date(),
      updatedAt: new Date(),
    }]);

    await loadAssistantContext(customerId, 40);

    expect(fetchAndTranscribeWhatsAppAudio).not.toHaveBeenCalled();
    expect(updateWhatsAppMediaTranscription).not.toHaveBeenCalled();
  });
});
