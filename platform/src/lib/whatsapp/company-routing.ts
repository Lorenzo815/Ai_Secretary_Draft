import "server-only";

import { ObjectId } from "mongodb";
import { legacyCompanyId } from "../companies/ownership";

export interface WhatsAppCompanyBinding {
  _id: string;
  companyId: ObjectId;
  wabaId?: string;
  phoneNumberId?: string;
  status: string;
}

export class ForwardingRoutingError extends Error {
  constructor(readonly code: "WHATSAPP_FORWARDING_COMPANY_UNRESOLVED" | "WHATSAPP_FORWARDING_MIXED_COMPANIES" | "WHATSAPP_FORWARDING_COMPANY_INACTIVE") {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function resolveWhatsAppCompany(payload: unknown, bindings: WhatsAppCompanyBinding[]): ObjectId {
  const object = record(payload);
  if (!object || object.object !== "whatsapp_business_account" || !Array.isArray(object.entry) || !object.entry.length) {
    throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_UNRESOLVED");
  }
  const owners = new Set<string>();
  for (const rawEntry of object.entry) {
    const entry = record(rawEntry);
    if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.changes) || !entry.changes.length) {
      throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_UNRESOLVED");
    }
    for (const rawChange of entry.changes) {
      const change = record(rawChange);
      const metadata = record(record(change?.value)?.metadata);
      const phone = metadata?.phone_number_id;
      const matches = bindings.filter(binding =>
        binding.companyId instanceof ObjectId && binding.wabaId === entry.id &&
        (typeof phone !== "string" || binding.phoneNumberId === phone),
      );
      const candidates = new Set(matches.map(binding => binding.companyId.toHexString()));
      if (entry.id === process.env.WHATSAPP_BUSINESS_ACCOUNT_ID &&
        (typeof phone !== "string" || phone === process.env.WHATSAPP_PHONE_NUMBER_ID)) {
        candidates.add(legacyCompanyId().toHexString());
      }
      if (candidates.size !== 1) throw new ForwardingRoutingError("WHATSAPP_FORWARDING_COMPANY_UNRESOLVED");
      for (const owner of candidates) owners.add(owner);
    }
  }
  if (owners.size !== 1) throw new ForwardingRoutingError("WHATSAPP_FORWARDING_MIXED_COMPANIES");
  return new ObjectId([...owners][0]);
}
