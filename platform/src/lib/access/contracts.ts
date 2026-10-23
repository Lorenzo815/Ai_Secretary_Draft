export const USER_LIMIT = 25;
export const ACCESS_MODULES = [
  { key: "overview", label: "Visão geral", description: "Indicadores e resumos operacionais, sem liberar outras páginas." },
  { key: "customers", label: "Clientes", description: "Cadastro e histórico completo do cliente, pagamentos e análise." },
  { key: "conversations", label: "Conversas", description: "Caixa de entrada, mensagens e mídias WhatsApp." },
  { key: "calendar", label: "Calendário", description: "Agenda, tipos de evento e disponibilidade." },
  { key: "studio", label: "Agent Studio", description: "Configuração e regras da inteligência artificial." },
  { key: "operations", label: "Operações", description: "Histórico e diagnósticos operacionais." },
  { key: "whatsapp", label: "Modelos WhatsApp", description: "Consulta e envio de modelos WhatsApp." },
  { key: "system", label: "Sistema", description: "Integrações, credenciais e parâmetros do sistema." },
] as const;

export type AccessModule = typeof ACCESS_MODULES[number]["key"];
export type AccessLevel = "none" | "read" | "manage";
export type Permissions = Record<AccessModule, AccessLevel>;
export class PermissionValidationError extends Error {}
export interface Principal {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  email: string;
  isAdmin: boolean;
  permissions: Permissions;
}
export interface CompanyProfile {
  id: string;
  name: string;
  legalName: string;
  cnpj: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
  createdAt: string;
  adminUserId: string;
  adminName: string;
  adminEmail: string;
}
export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  disabled: boolean;
  isAdmin: boolean;
  permissions: Permissions;
}
export interface CompanySettings {
  company: CompanyProfile;
  users: ManagedUser[];
  userLimit: number;
}

export function emptyPermissions(): Permissions {
  return { overview: "none", customers: "none", conversations: "none", calendar: "none", studio: "none", operations: "none", whatsapp: "none", system: "none" };
}

export function parsePermissions(value: unknown): Permissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PermissionValidationError("Permissões inválidas.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== ACCESS_MODULES.length) throw new PermissionValidationError("Informe todas as permissões, sem campos adicionais.");
  const permissions = emptyPermissions();
  for (const { key } of ACCESS_MODULES) {
    const level = input[key];
    if (level !== "none" && level !== "read" && level !== "manage") throw new PermissionValidationError("Nível de acesso inválido.");
    permissions[key] = level;
  }
  return permissions;
}

export function canAccess(principal: Principal, module: AccessModule, level: "read" | "manage" = "read") {
  return principal.isAdmin || principal.permissions[module] === "manage" || (level === "read" && principal.permissions[module] === "read");
}
