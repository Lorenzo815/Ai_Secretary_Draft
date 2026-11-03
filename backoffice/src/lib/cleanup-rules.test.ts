import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { CLEANUP_TARGETS, cleanupFilter } from "./cleanup-rules";

const companyId = new ObjectId();
const cutoff = new Date("2026-08-01T00:00:00Z");

describe("history cleanup rules", () => {
  it("never targets patient, conversation, agenda, payment, configuration or audit data", () => {
    const collections = Object.values(CLEANUP_TARGETS).map((target) => target.collection);
    for (const forbidden of [
      "crm_customers", "whatsapp_messages", "calendar_appointments", "payment_requests", "payment_transactions",
      "appointment_confirmations", "assistant_config_snapshots", "backoffice_audit", "users", "companies",
    ]) expect(collections).not.toContain(forbidden);
  });

  it("confines every filter to the chosen clinic and to documents older than the cutoff", () => {
    const filters = (["runs_delete", "ai_task_calls", "lead_qualification_history", "whatsapp_coexistence_webhook_events", "whatsapp_forwarding_deliveries"] as const)
      .map((target) => cleanupFilter(target, { companyIds: [companyId], cutoff }));
    for (const filter of filters) {
      expect(filter.companyId).toEqual({ $in: [companyId] });
      expect(Object.values(filter).some((value) => value && typeof value === "object" && "$lt" in value && value.$lt === cutoff)).toBe(true);
    }
    expect(cleanupFilter("ai_task_calls", { companyIds: null, cutoff })).not.toHaveProperty("companyId");
    const other = new ObjectId();
    expect(cleanupFilter("ai_task_calls", { companyIds: [companyId, other], cutoff }).companyId).toEqual({ $in: [companyId, other] });
  });

  it("keeps runs that are still running or whose job is still queued", () => {
    const queued = new ObjectId();
    const filter = cleanupFilter("runs_delete", { companyIds: [companyId], cutoff, queuedJobIds: [queued] });
    expect(filter.status).toEqual({ $in: ["completed", "failed", "superseded"] });
    expect(filter.jobId).toEqual({ $nin: [queued] });
  });

  it("keeps the latest qualification of each patient, pending deliveries and unsynced message echoes", () => {
    const latest = new ObjectId();
    expect(cleanupFilter("lead_qualification_history", { companyIds: [companyId], cutoff, keepIds: [latest] })._id).toEqual({ $nin: [latest] });
    expect(cleanupFilter("whatsapp_forwarding_deliveries", { companyIds: [companyId], cutoff }).status).toEqual({ $in: ["delivered", "failed", "cancelled"] });
    expect(cleanupFilter("whatsapp_coexistence_webhook_events", { companyIds: [companyId], cutoff }).$or).toEqual([
      { processedAt: { $ne: null } }, { field: { $ne: "smb_message_echoes" } },
    ]);
  });
});
