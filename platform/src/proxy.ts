import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { resolveToken } from "./lib/access/session";
import { allows, routePolicy } from "./lib/access/policy";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "");
  const policy = routePolicy(path, request.method);
  if (policy === "public") return NextResponse.next();
  const api = path.startsWith("/api/");
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    console.error("Access control unavailable: session secret is not configured.");
    return NextResponse.json({ error: "Controle de acesso indisponível." }, { status: 503 });
  }
  try {
    const principal = await resolveToken(await getToken({ req: request, secret }), secret);
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
      if (origin !== request.nextUrl.origin) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
    }
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    console.error("Access control validation failed.", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível validar o acesso. Tente novamente." }, { status: 503 });
  }
}

export const config = { matcher: ["/dashboard/:path*", "/api/:path*"] };
