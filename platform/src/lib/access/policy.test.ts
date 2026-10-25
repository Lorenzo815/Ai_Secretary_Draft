import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyPermissions, parsePermissions, type Principal } from "./contracts";
import { allows, pagePolicy, routePolicy } from "./policy";

const user: Principal = { id: "user", companyId: "company", companyName: "Company", name: "Test", email: "test@example.com", isAdmin: false, permissions: emptyPermissions() };

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename) : [filename];
  });
}

describe("default-deny access catalog", () => {
  it("rejects missing, unknown or malformed permissions", () => {
    for (const value of [null, {}, { ...emptyPermissions(), admin: "manage" }, { ...emptyPermissions(), calendar: true }]) {
      expect(() => parsePermissions(value)).toThrow();
    }
  });
  it("denies all unknown routes/methods even to the administrator", () => {
    for (const [url, method] of [["/api/unknown", "GET"], ["/api/settings", "GET"], ["/dashboard", "POST"], ["/dashboard/new-page", "GET"]]) {
      expect(allows({ ...user, isAdmin: true }, routePolicy(url, method))).toBe(false);
    }
  });
  it("does not let read-only users mutate API data", () => {
    const reader = { ...user, permissions: { ...emptyPermissions(), calendar: "read" as const } };
    expect(allows(reader, routePolicy("/api/calendar", "GET"))).toBe(true);
    for (const method of ["POST", "PUT"]) expect(allows(reader, routePolicy("/api/calendar", method))).toBe(false);
    expect(allows(reader, routePolicy("/api/calendar/appointments/123456789012345678901234", "DELETE"))).toBe(false);
    expect(allows(reader, pagePolicy("/dashboard/settings/system"))).toBe(false);
  });
  it("grants overview-only access without granting other pages or APIs", () => {
    const viewer = { ...user, permissions: { ...emptyPermissions(), overview: "read" as const } };
    expect(allows(viewer, pagePolicy("/dashboard"))).toBe(true);
    for (const page of ["/dashboard/clientes", "/dashboard/conversas", "/dashboard/calendario", "/dashboard/operacoes"]) {
      expect(allows(viewer, pagePolicy(page))).toBe(false);
    }
    expect(allows(viewer, routePolicy("/api/calendar", "GET"))).toBe(false);
    expect(allows(viewer, routePolicy("/api/customers/123456789012345678901234", "GET"))).toBe(false);
  });
  it("reserves user administration and destructive cleanup to the sole admin", () => {
    const manager = { ...user, permissions: Object.fromEntries(Object.keys(emptyPermissions()).map(key => [key, "manage"])) as Principal["permissions"] };
    for (const [url, method] of [["/api/company/users", "POST"], ["/api/company/users", "DELETE"], ["/api/company/settings", "PATCH"], ["/api/company/transfer-admin", "POST"], ["/api/settings", "DELETE"]]) {
      expect(allows(manager, routePolicy(url, method))).toBe(false);
      expect(allows({ ...manager, isAdmin: true }, routePolicy(url, method))).toBe(true);
    }
  });
  it("permits only the existing machine-authenticated webhook/worker endpoints", () => {
    expect(routePolicy("/api/webhooks/whatsapp", "POST")).toBe("public");
    expect(routePolicy("/api/internal/assistant/process", "POST")).toBe("public");
    expect(routePolicy("/api/internal/assistant/process", "GET")).toBeNull();
    expect(routePolicy("/api/webhooks/whatsapp/anything", "POST")).toBeNull();
  });
  it("reserves all forwarding settings and test actions to the company admin", () => {
    const manager = { ...user, permissions: { ...emptyPermissions(), system: "manage" as const } };
    for (const method of ["GET", "PUT", "POST"]) {
      const policy = routePolicy("/api/company/webhook-forwarding", method);
      expect(allows(manager, policy)).toBe(false);
      expect(allows({ ...manager, isAdmin: true }, policy)).toBe(true);
    }
    expect(routePolicy("/api/company/webhook-forwarding", "DELETE")).toBeNull();
  });
  it("covers every existing API HTTP handler and dashboard page explicitly", () => {
    const root = path.join(process.cwd(), "src", "app");
    for (const absolute of filesIn(path.join(root, "api")).filter(filename => path.basename(filename) === "route.ts")) {
      const filename = path.relative(path.join(root, "api"), absolute);
      const url = `/api/${filename.replace(/[\\/]route\.ts$/, "").replaceAll("\\", "/").replace("[...nextauth]", "session").replace("[id]", "123456789012345678901234").replace("[messageId]", "wamid.example").replace("[postalCode]", "01310100")}`;
      const source = readFileSync(path.join(root, "api", filename), "utf8");
      for (const match of source.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(/g)) {
        expect(routePolicy(url, match[1]), `${match[1]} ${url}`).not.toBeNull();
      }
    }
    for (const absolute of filesIn(path.join(root, "dashboard")).filter(filename => path.basename(filename) === "page.tsx")) {
      const filename = path.relative(path.join(root, "dashboard"), absolute);
      const suffix = filename.replace(/(?:^|[\\/])page\.tsx$/, "").replaceAll("\\", "/").replace("[id]", "123456789012345678901234");
      expect(pagePolicy(`/dashboard${suffix ? `/${suffix}` : ""}`), filename).not.toBeNull();
    }
  });
});
