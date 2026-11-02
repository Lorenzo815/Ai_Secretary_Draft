import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { resolveToken } from "./lib/access/session";
import { allows, routePolicy } from "./lib/access/policy";
import { sessionCookie } from "./lib/access/cookies";
import { COMPANY_HEADER } from "./lib/companies/tenant-header";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "");
  const policy = routePolicy(path, request.method);
  // The tenant header is trusted downstream, so a client-supplied value must never pass through.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete(COMPANY_HEADER);
  if (policy === "public") return NextResponse.next({ request: { headers: forwardedHeaders } });
  const api = path.startsWith("/api/");
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    console.error("Access control unavailable: session secret is not configured.");
    return NextResponse.json({ error: "Controle de acesso indisponível." }, { status: 503 });
  }
  try {
    const cookie = sessionCookie();
    const principal = await resolveToken(await getToken({
      req: request, secret, cookieName: cookie.name, secureCookie: cookie.options.secure,
    }), secret);
    if (!principal) {
      return api
        ? NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 })
        : NextResponse.redirect(new URL("/login?callbackUrl=%2Fdashboard%2Fsettings", request.url));
    }
    if (!allows(principal, policy)) {
      return api
        ? NextResponse.json({ error: "Acesso não permitido." }, { status: 403 })
        : NextResponse.redirect(new URL("/dashboard/access-denied", request.url));
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (!origin || !allowedOrigins(request).has(origin)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
    }
    forwardedHeaders.set(COMPANY_HEADER, principal.companyId);
    const response = NextResponse.next({ request: { headers: forwardedHeaders } });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "Unknown";
    const failure = errorType.startsWith("Mongo") ? "ACCESS_DATABASE_UNAVAILABLE" : "ACCESS_SESSION_UNAVAILABLE";
    console.error("Access control validation failed.", { errorType, failure });
    return NextResponse.json({ error: "Não foi possível validar o acesso. Tente novamente.", code: failure }, { status: 503 });
  }
}

// Behind a TLS-terminating ingress (e.g. Azure Container Apps) the request URL may be
// http:// while the browser origin is https://, so the configured public URL is also trusted.
function allowedOrigins(request: NextRequest) {
  const origins = new Set([request.nextUrl.origin]);
  try {
    if (process.env.NEXTAUTH_URL) origins.add(new URL(process.env.NEXTAUTH_URL).origin);
  } catch {
    console.error("NEXTAUTH_URL is not a valid URL.");
  }
  return origins;
}

export const config = { matcher: ["/dashboard/:path*", "/api/:path*"] };
