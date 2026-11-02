// Mirrors of the platform's rules (platform/src/lib/companies/ownership.ts and access/contracts.ts).
// Keep in sync: the platform only accepts companies, users and settings in exactly these shapes.

export const LEGACY_COMPANY_ID = "9b9d1f4b4f16cf6e84abcce4";

/** Oria-wide documents shared by every clinic. */
export const PLATFORM_GLOBAL_COLLECTIONS = new Set(["ai_provider_credentials", "whatsapp_embedded_signup_config"]);

export const ACCESS_MODULES = [
  { key: "overview", label: "Visão geral" },
  { key: "customers", label: "Clientes" },
  { key: "conversations", label: "Conversas" },
  { key: "calendar", label: "Calendário" },
  { key: "studio", label: "Agent Studio" },
  { key: "operations", label: "Operações" },
  { key: "whatsapp", label: "Modelos WhatsApp" },
  { key: "system", label: "Sistema" },
] as const;

export type AccessModule = typeof ACCESS_MODULES[number]["key"];
export type AccessLevel = "none" | "read" | "manage";
export type Permissions = Record<AccessModule, AccessLevel>;

export function emptyPermissions(): Permissions {
  return Object.fromEntries(ACCESS_MODULES.map(({ key }) => [key, "none"])) as Permissions;
}

export function parsePermissions(input: unknown): Permissions {
  const permissions = emptyPermissions();
  if (!input || typeof input !== "object") return permissions;
  for (const { key } of ACCESS_MODULES) {
    const value = (input as Record<string, unknown>)[key];
    if (value === "none" || value === "read" || value === "manage") permissions[key] = value;
  }
  return permissions;
}

/** `_id` of a per-company settings document: the original clinic keeps its fixed ids. */
export function companyScopedId(companyId: string, key: string) {
  return companyId === LEGACY_COMPANY_ID ? key : `${companyId}:${key}`;
}

export const COMPANY_STATUSES = ["test", "active", "suspended"] as const;
export type CompanyStatus = typeof COMPANY_STATUSES[number];

export const USER_LIMIT = 25;
export const DEFAULT_GRAPH_VERSION = "v25.0";
