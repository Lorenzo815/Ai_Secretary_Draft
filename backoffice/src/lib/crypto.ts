import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isEncryptedShape } from "./masking";

// Same AES-256-GCM formats as the platform: WhatsApp tokens, AI and payment credentials ({ciphertext, iv, authTag})
// and CPF ({encrypted, iv, authTag}, key = SHA-256 of the platform's PII secret).

function base64Key(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

function candidateKeys(): Buffer[] {
  const keys: Buffer[] = [];
  for (const name of ["WHATSAPP_TOKEN_ENCRYPTION_KEY", "AI_CREDENTIALS_ENCRYPTION_KEY", "PAYMENT_CREDENTIALS_ENCRYPTION_KEY"]) {
    const key = base64Key(name);
    if (key) keys.push(key);
  }
  const pii = process.env.PLATFORM_PII_SECRET?.trim();
  if (pii) keys.push(createHash("sha256").update(pii).digest());
  return keys;
}

export function decryptValue(value: unknown): string {
  if (!isEncryptedShape(value)) throw new Error("O campo não está no formato criptografado esperado.");
  const ciphertext = Buffer.from(value.ciphertext ?? value.encrypted ?? "", "base64");
  for (const key of candidateKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
      decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key: GCM authentication fails; try the next one.
    }
  }
  throw new Error("Nenhuma chave configurada no back-office consegue abrir este valor.");
}

export function encryptWhatsAppToken(token: string) {
  const key = base64Key("WHATSAPP_TOKEN_ENCRYPTION_KEY");
  if (!key) throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY não está configurada no back-office.");
  return seal(token, key);
}

/** Same key choice as the platform: AI_CREDENTIALS_ENCRYPTION_KEY, falling back to WHATSAPP_TOKEN_ENCRYPTION_KEY. */
export function encryptAiCredential(secret: string) {
  const key = base64Key("AI_CREDENTIALS_ENCRYPTION_KEY") ?? base64Key("WHATSAPP_TOKEN_ENCRYPTION_KEY");
  if (!key) throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY (ou WHATSAPP_TOKEN_ENCRYPTION_KEY) não está configurada no back-office.");
  return seal(secret, key);
}

function seal(token: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}
