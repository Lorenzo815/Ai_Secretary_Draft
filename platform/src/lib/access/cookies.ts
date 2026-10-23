export function sessionCookie() {
  const secure = Boolean(process.env.VERCEL) || process.env.NEXTAUTH_URL?.startsWith("https://") === true;
  return {
    name: secure ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure },
  };
}
