import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, verifySessionToken } from "./lib/session";

/** Every route except login (and, in local development only, the authenticator setup) needs a valid session. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || (process.env.NODE_ENV === "development" && path === "/setup");
  if (!isPublic && !await verifySessionToken(request.cookies.get(sessionCookieName())?.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
