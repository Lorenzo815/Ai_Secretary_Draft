import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth";
import { ManagementError } from "./management";
import { PermissionValidationError } from "./contracts";

export async function requirePrincipal(admin = false) {
  const session = await getServerSession(authOptions);
  if (!session?.principal) throw new ManagementError("Sessão expirada. Entre novamente.", 401);
  if (admin && !session.principal.isAdmin) throw new ManagementError("Somente o administrador pode executar esta operação.", 403);
  return session.principal;
}

export async function managementResponse(run: () => Promise<unknown>) {
  try {
    return NextResponse.json(await run(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PermissionValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Company user management failed.", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Não foi possível concluir a operação." }, { status: 500 });
  }
}

export async function readManagementInput(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); }
  catch { throw new ManagementError("Solicitação JSON inválida."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ManagementError("Solicitação inválida.");
  return value as Record<string, unknown>;
}
