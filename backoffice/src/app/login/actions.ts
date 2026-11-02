"use server";

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { loginWithCode, logout } from "@/lib/auth";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";

export async function loginAction(_: { error: string } | null, form: FormData) {
  const result = await loginWithCode(String(form.get("code") ?? ""));
  if (!result.ok) return { error: result.error };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

/** Local development only: writes a new authenticator secret (and a session secret if missing) to .env.local. */
export async function generateSecretAction() {
  if (process.env.NODE_ENV !== "development") throw new Error("Disponível apenas em desenvolvimento local.");
  const file = join(process.cwd(), ".env.local");
  const current = await readFile(file, "utf8").catch(() => "");
  const secret = generateTotpSecret();
  const lines = current.split(/\r?\n/).filter((line) => !line.startsWith("BACKOFFICE_TOTP_SECRET="));
  lines.push(`BACKOFFICE_TOTP_SECRET=${secret}`);
  if (!process.env.BACKOFFICE_SESSION_SECRET || process.env.BACKOFFICE_SESSION_SECRET.length < 32) {
    const sessionSecret = randomBytes(48).toString("base64url");
    lines.push(`BACKOFFICE_SESSION_SECRET=${sessionSecret}`);
    process.env.BACKOFFICE_SESSION_SECRET = sessionSecret;
  }
  await writeFile(file, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, "utf8");
  process.env.BACKOFFICE_TOTP_SECRET = secret;
  redirect("/setup");
}

export async function checkSetupCodeAction(_: { ok: boolean; message: string } | null, form: FormData) {
  if (process.env.NODE_ENV !== "development") return { ok: false, message: "Indisponível." };
  const secret = process.env.BACKOFFICE_TOTP_SECRET;
  if (!secret) return { ok: false, message: "Gere o segredo primeiro." };
  return verifyTotp(secret, String(form.get("code") ?? "")) !== null
    ? { ok: true, message: "Código correto. O aplicativo está configurado; agora entre pela tela de login." }
    : { ok: false, message: "Código incorreto. Confira se escaneou o QR code mais recente e se o relógio do celular está certo." };
}
