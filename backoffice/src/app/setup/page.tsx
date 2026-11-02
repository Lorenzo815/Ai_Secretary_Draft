import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { otpauthUri } from "@/lib/totp";
import { generateSecretAction } from "../login/actions";
import { SetupCheck } from "./setup-check";

export const metadata: Metadata = { title: "Configurar autenticador" };
export const dynamic = "force-dynamic";

/** Local development only: never reachable on a deployed back-office. */
export default async function SetupPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const secret = process.env.BACKOFFICE_TOTP_SECRET?.trim();
  const qr = secret ? await QRCode.toDataURL(otpauthUri(secret, process.env.BACKOFFICE_OWNER || "backoffice"), { margin: 1, width: 240 }) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-night px-6 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-soft-jade">Somente local</p>
        <h1 className="mt-2 font-heading text-2xl font-semibold">Configurar Google Authenticator</h1>
        {!qr ? (
          <>
            <p className="mt-3 text-sm text-white/70">Gera um segredo novo e grava em <code>.env.local</code>. Os códigos de um segredo anterior deixam de valer.</p>
            <form action={generateSecretAction} className="mt-6">
              <button className="h-11 w-full rounded-xl bg-soft-jade text-sm font-semibold text-night hover:bg-white">Gerar segredo</button>
            </form>
          </>
        ) : (
          <>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-white/75">
              <li>No Google Authenticator, toque em <strong>+</strong> → <strong>Ler código QR</strong>.</li>
              <li>Escaneie o código abaixo (conta “Oria”).</li>
              <li>Digite o código gerado para confirmar.</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code do autenticador" width={240} height={240} className="mx-auto mt-5 rounded-xl bg-white p-2" />
            <SetupCheck />
            <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              Para publicar no Vercel, copie <code>BACKOFFICE_TOTP_SECRET</code> e <code>BACKOFFICE_SESSION_SECRET</code> de <code>.env.local</code> para as variáveis do projeto.
              <form action={generateSecretAction} className="mt-2">
                <button className="font-semibold text-amber-300 hover:underline">Gerar outro segredo (invalida o atual)</button>
              </form>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
