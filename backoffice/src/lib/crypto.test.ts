import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptValue, encryptWhatsAppToken } from "./crypto";

afterEach(() => vi.unstubAllEnvs());

describe("platform-compatible encryption", () => {
  it("decrypts what it encrypts with the WhatsApp key, and fails without a matching key", () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const sealed = encryptWhatsAppToken("EAAB-token");
    expect(sealed).not.toHaveProperty("token");
    expect(decryptValue(sealed)).toBe("EAAB-token");

    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptValue(sealed)).toThrow("Nenhuma chave");
  });
});
