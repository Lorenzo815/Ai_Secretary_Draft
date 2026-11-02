// Signed session cookie, verifiable both in the proxy and on the server (Web Crypto, no Node-only APIs).

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-oria-backoffice" : "oria-backoffice";
}

function encode(bytes: ArrayBuffer | Uint8Array) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(data: string) {
  const secret = process.env.BACKOFFICE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("BACKOFFICE_SESSION_SECRET (mínimo 32 caracteres) não está configurada.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

/** Ties sessions to the current authenticator secret: replacing it signs everyone out. */
async function secretFingerprint() {
  const secret = process.env.BACKOFFICE_TOTP_SECRET ?? "";
  return encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))).slice(0, 16);
}

export async function createSessionToken(now = Date.now()) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({
    v: 1, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS, k: await secretFingerprint(),
  })));
  return `${payload}.${encode(await hmac(payload))}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()) {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const expected = await hmac(payload);
    const received = decode(signature);
    if (received.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ received[i];
    if (diff !== 0) return false;
    const data = JSON.parse(new TextDecoder().decode(decode(payload))) as { v?: number; exp?: number; k?: string };
    return data.v === 1 && typeof data.exp === "number" && data.exp * 1000 > now && data.k === await secretFingerprint();
  } catch {
    return false;
  }
}
