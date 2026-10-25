import { ObjectId } from "mongodb";

export const LEGACY_COMPANY_ID = "9b9d1f4b4f16cf6e84abcce4";
export const LEGACY_COMPANY_KEY = "legacy";

export const COMPANY_OWNED_COLLECTIONS = [
  "ai_model_config",
  "ai_provider_credentials",
  "ai_task_calls",
  "assistant_agent_config",
  "assistant_conversation_states",
  "assistant_follow_up_config",
  "assistant_run_steps",
  "assistant_runs",
  "automation_jobs",
  "automation_rules",
  "calendar_access_events",
  "calendar_appointments",
  "calendar_plan_options",
  "calendar_settings",
  "crm_customers",
  "lead_qualification_config",
  "lead_qualification_history",
  "lead_qualification_locks",
  "payment_provider_config",
  "payment_provider_credentials",
  "payment_requests",
  "qualification_milestones",
  "users",
  "whatsapp_coexistence_webhook_events",
  "whatsapp_embedded_signup_config",
  "whatsapp_embedded_signup_connections",
  "whatsapp_forwarding_config",
  "whatsapp_forwarding_deliveries",
  "whatsapp_messages",
] as const;

export interface CompanyDocument {
  _id: ObjectId;
  key: typeof LEGACY_COMPANY_KEY;
  name: string;
  status: "active";
  isolationReady: false;
  createdAt: Date;
}

export function legacyCompanyId() {
  return new ObjectId(LEGACY_COMPANY_ID);
}

export function withLegacyCompany<T extends object>(document: T): T & { companyId: ObjectId } {
  if ("companyId" in document && (
    !(document.companyId instanceof ObjectId) || !document.companyId.equals(legacyCompanyId())
  )) {
    throw new Error("A propriedade da empresa já existe e não pode ser substituída.");
  }
  return { ...document, companyId: legacyCompanyId() };
}
