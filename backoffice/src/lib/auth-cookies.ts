// Own cookie names: browsers don't separate cookies by port, so on localhost the platform (:3000)
// and the back-office (:3200) would otherwise overwrite each other's next-auth cookies.
const secure = (process.env.NEXTAUTH_URL ?? "").startsWith("https://") || process.env.VERCEL === "1";
const prefix = secure ? "__Secure-" : "";
const base = { httpOnly: true, sameSite: "lax" as const, path: "/", secure };

export const SESSION_COOKIE = `${prefix}oria-backoffice.session-token`;
export const SECURE_COOKIES = secure;

export const authCookies = {
  sessionToken: { name: SESSION_COOKIE, options: base },
  callbackUrl: { name: `${prefix}oria-backoffice.callback-url`, options: base },
  csrfToken: { name: `${secure ? "__Host-" : ""}oria-backoffice.csrf-token`, options: base },
  pkceCodeVerifier: { name: `${prefix}oria-backoffice.pkce.code_verifier`, options: { ...base, maxAge: 900 } },
  state: { name: `${prefix}oria-backoffice.state`, options: { ...base, maxAge: 900 } },
  nonce: { name: `${prefix}oria-backoffice.nonce`, options: base },
};
