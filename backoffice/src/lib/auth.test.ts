import { afterEach, describe, expect, it, vi } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, verifyTotp } from "./totp";
import { createSessionToken, verifySessionToken } from "./session";

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (last 6 of the 8-digit values).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("Google Authenticator codes (TOTP)", () => {
  it.each([[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]])(
    "matches the RFC 6238 vector at %i s", (seconds, code) => {
      expect(totpAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
    },
  );

  it("accepts the current code and one step of clock drift, nothing else", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 2), now)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
  });

  it("round-trips base32 and builds an authenticator URI", () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(otpauthUri(secret)).toContain(`secret=${secret}&issuer=Oria`);
  });
});

describe("back-office session", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts its own token until it expires, and rejects tampering or a replaced authenticator secret", async () => {
    vi.stubEnv("BACKOFFICE_SESSION_SECRET", "x".repeat(40));
    vi.stubEnv("BACKOFFICE_TOTP_SECRET", "JBSWY3DPEHPK3PXP");
    const now = Date.now();
    const token = await createSessionToken(now);
    expect(await verifySessionToken(token, now)).toBe(true);
    expect(await verifySessionToken(token, now + 13 * 60 * 60 * 1000)).toBe(false);
    expect(await verifySessionToken(`${token.split(".")[0]}.AAAA`, now)).toBe(false);
    expect(await verifySessionToken(undefined, now)).toBe(false);
    vi.stubEnv("BACKOFFICE_TOTP_SECRET", "KRSXG5CTMVRXEZLU");
    expect(await verifySessionToken(token, now)).toBe(false);
    vi.stubEnv("BACKOFFICE_TOTP_SECRET", "JBSWY3DPEHPK3PXP");
    vi.stubEnv("BACKOFFICE_SESSION_SECRET", "y".repeat(40));
    expect(await verifySessionToken(token, now)).toBe(false);
  });
});
