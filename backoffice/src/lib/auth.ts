import "server-only";

import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { authCookies } from "./auth-cookies";

export function allowedEmails() {
  return (process.env.BACKOFFICE_ALLOWED_EMAILS ?? "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: unknown) {
  return typeof email === "string" && allowedEmails().includes(email.trim().toLowerCase());
}

/** Local `next dev` only: lets an allowed email skip Google sign-in. Never active in production builds. */
export function devBypassEmail() {
  const email = process.env.BACKOFFICE_DEV_EMAIL;
  return process.env.NODE_ENV === "development" && isAllowedEmail(email) ? email!.toLowerCase() : null;
}

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export const authOptions: NextAuthOptions = {
  cookies: authCookies,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ account, profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      return account?.provider === "google" && verified && isAllowedEmail(profile?.email);
    },
  },
};

/** Every page and server action calls this; the allow-list is re-checked on each request. */
export async function requireOwner(): Promise<string> {
  const bypass = devBypassEmail();
  if (bypass) return bypass;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!isAllowedEmail(email)) redirect("/login");
  return email!.toLowerCase();
}
