import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { SECURE_COOKIES, SESSION_COOKIE } from "./lib/auth-cookies";

function allowed(email: unknown) {
  const list = (process.env.BACKOFFICE_ALLOWED_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return typeof email === "string" && list.includes(email.toLowerCase());
}

/** Everything except sign-in requires an allowed Google account (pages and server actions re-check it). */
export async function proxy(request: NextRequest) {
  const devBypass = process.env.NODE_ENV === "development" && allowed(process.env.BACKOFFICE_DEV_EMAIL);
  const token = devBypass ? null : await getToken({
    req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: SESSION_COOKIE, secureCookie: SECURE_COOKIES,
  });
  if (!devBypass && !allowed(token?.email)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
