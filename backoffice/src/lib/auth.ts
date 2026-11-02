import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "./audit";
import { getDb } from "./mongodb";
import { createSessionToken, sessionCookieName, SESSION_TTL_SECONDS, verifySessionToken } from "./session";
import { STEP_SECONDS, verifyTotp } from "./totp";

const AUTH_COLLECTION = "backoffice_auth";
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 60 * 60 * 1000;

interface AuthState { _id: "totp"; lastStep?: number; failures?: Date[] }

export function ownerName() {
  return process.env.BACKOFFICE_OWNER?.trim() || "owner";
}

export function totpConfigured() {
  return Boolean(process.env.BACKOFFICE_TOTP_SECRET?.trim() && (process.env.BACKOFFICE_SESSION_SECRET?.length ?? 0) >= 32);
}

/** Every page and server action calls this. */
export async function requireOwner(): Promise<string> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!await verifySessionToken(token)) redirect("/login");
  return ownerName();
}

/**
 * Login with a Google Authenticator code. Failures are counted globally (not per IP, which an attacker can
 * rotate): 5 failures within an hour block every attempt until the oldest is an hour old. Each code works once.
 */
export async function loginWithCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env.BACKOFFICE_TOTP_SECRET?.trim();
  if (!secret || !totpConfigured()) {
    return { ok: false, error: "O acesso ainda não foi configurado (BACKOFFICE_TOTP_SECRET e BACKOFFICE_SESSION_SECRET)." };
  }
  const states = (await getDb()).collection<AuthState>(AUTH_COLLECTION);
  const now = new Date();
  const state = await states.findOne({ _id: "totp" });
  const recent = (state?.failures ?? []).filter((at) => now.getTime() - at.getTime() < LOCKOUT_MS);
  if (recent.length >= MAX_FAILURES) {
    const until = new Date(Math.min(...recent.map((at) => at.getTime())) + LOCKOUT_MS);
    const time = until.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    return { ok: false, error: `Muitas tentativas incorretas. Tente novamente após ${time}.` };
  }

  const step = verifyTotp(secret, code, now.getTime());
  if (step === null || (state?.lastStep ?? -1) >= step) {
    await states.updateOne({ _id: "totp" }, { $push: { failures: { $each: [now], $slice: -20 } } }, { upsert: true });
    await audit({ actor: "anonymous", action: "login.failure", detail: step === null ? "código incorreto" : "código já utilizado" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { ok: false, error: "Código incorreto ou já utilizado." };
  }
  // Atomic claim of the time step: a concurrent request with the same code loses this race.
  const claimed = await states.updateOne(
    { _id: "totp", $or: [{ lastStep: { $lt: step } }, { lastStep: { $exists: false } }] },
    { $set: { lastStep: step, failures: [] } },
    { upsert: true },
  ).catch(() => null);
  if (!claimed || (claimed.matchedCount === 0 && claimed.upsertedCount === 0)) {
    return { ok: false, error: "Código já utilizado." };
  }

  (await cookies()).set(sessionCookieName(), await createSessionToken(now.getTime()), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_TTL_SECONDS,
  });
  await audit({ actor: ownerName(), action: "login.success", detail: `passo ${step} (${STEP_SECONDS}s)` });
  return { ok: true };
}

export async function logout() {
  (await cookies()).delete(sessionCookieName());
}
