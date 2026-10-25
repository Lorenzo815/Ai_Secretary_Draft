import { canAccess, type AccessModule, type Principal } from "./contracts";

type Requirement = { module: AccessModule; level: "read" | "manage" };
export type RoutePolicy = "public" | "session" | "admin" | Requirement[] | { anyOf: Requirement[] } | null;
const read = (module: AccessModule): Requirement => ({ module, level: "read" });
const manage = (module: AccessModule): Requirement => ({ module, level: "manage" });

export function pagePolicy(path: string): RoutePolicy {
  if (path === "/dashboard/settings" || path === "/dashboard/access-denied") return "session";
  if (path === "/dashboard") return [read("overview")];
  if (path === "/dashboard/clientes" || /^\/dashboard\/clientes\/[a-f0-9]{24}$/i.test(path)) return [read("customers")];
  const pages: Record<string, AccessModule> = {
    "/dashboard/conversas": "conversations", "/dashboard/calendario": "calendar",
    "/dashboard/fluxos": "studio", "/dashboard/operacoes": "operations",
    "/dashboard/whatsapp": "whatsapp", "/dashboard/settings/system": "system",
  };
  return pages[path] ? [read(pages[path])] : null;
}

export function routePolicy(path: string, method: string): RoutePolicy {
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return "public";
  if ((path === "/api/webhooks/whatsapp" && ["GET", "POST"].includes(method)) ||
    (path === "/api/webhooks/mercado-pago" && method === "POST") ||
    (path === "/api/internal/assistant/process" && method === "POST")) return "public";
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return method === "GET" || method === "HEAD" ? pagePolicy(path) : null;
  if (path === "/api/company/settings") return method === "GET" ? "session" : method === "PATCH" ? "admin" : null;
  if (path === "/api/company/users") return ["GET", "POST", "PATCH", "DELETE"].includes(method) ? "admin" : null;
  if (path === "/api/company/transfer-admin") return method === "POST" ? "admin" : null;
  if (path === "/api/company/webhook-forwarding") return ["GET", "PUT", "POST"].includes(method) ? "admin" : null;
  const access = (module: AccessModule, allowed: string[]) =>
    allowed.includes(method) ? [method === "GET" || method === "HEAD" ? read(module) : manage(module)] : null;
  if (path === "/api/customers") return access("customers", ["POST"]);
  if (/^\/api\/customers\/[a-f0-9]{24}$/i.test(path)) return access("customers", ["GET", "PATCH"]);
  if (/^\/api\/customers\/[a-f0-9]{24}\/(cpf|qualification)$/i.test(path)) return access("customers", path.endsWith("/cpf") ? ["GET"] : ["GET", "POST"]);
  if (/^\/api\/customers\/[a-f0-9]{24}\/(status|payment|messages)$/i.test(path)) return access("customers", path.endsWith("/status") ? ["PUT"] : ["POST"]);
  if (path === "/api/calendar") return access("calendar", ["GET", "POST", "PUT"]);
  if (path === "/api/calendar/access-events") return access("calendar", ["GET", "POST"]);
  if (/^\/api\/calendar\/(appointments|access-events)\/[a-f0-9]{24}$/i.test(path)) return access("calendar", ["PATCH", "DELETE"]);
  if (path === "/api/assistant/studio") return access("studio", ["GET", "PUT"]);
  if (path === "/api/settings") return method === "DELETE" ? "admin" : access("system", ["PUT", "PATCH", "POST"]);
  if (path === "/api/settings/ai-models") return access("system", ["GET", "PUT", "PATCH", "POST"]);
  if (path === "/api/whatsapp/inbox") return access("conversations", ["GET", "PATCH"]);
  if (path === "/api/whatsapp/messages") return access("conversations", ["GET", "POST"]);
  if (/^\/api\/whatsapp\/media\/[^/]+$/.test(path)) return method === "GET" ? { anyOf: [read("conversations"), read("customers")] } : null;
  if (path === "/api/whatsapp/templates") return access("whatsapp", ["GET", "POST"]);
  if (path === "/api/whatsapp/status") return access("system", ["GET"]);
  if (/^\/api\/whatsapp\/embedded-signup\/(activate|exchange|finalize|recover)$/.test(path)) return access("system", ["POST"]);
  if (path === "/api/whatsapp/embedded-signup/config") return access("system", ["PUT"]);
  if (path === "/api/whatsapp/embedded-signup/readiness") return access("system", ["GET"]);
  if (/^\/api\/postal-code\/[^/]+$/.test(path)) return method === "GET" ? [manage("customers")] : null;
  return null;
}

export function allows(principal: Principal, policy: RoutePolicy) {
  if (policy === null) return false;
  if (policy === "public" || policy === "session") return true;
  if (policy === "admin") return principal.isAdmin;
  if ("anyOf" in policy) return policy.anyOf.some(requirement => canAccess(principal, requirement.module, requirement.level));
  return policy.every(requirement => canAccess(principal, requirement.module, requirement.level));
}
