import { PLATFORM_GLOBAL_COLLECTIONS } from "./platform-rules";

export type WriteOperation = "insert" | "update" | "delete" | "bulk-update" | "bulk-delete";

/**
 * The phrase that must be typed to confirm a risky write, or null when none is needed.
 * Risky: deletes, bulk writes, and anything touching a clinic in production or Oria-wide settings.
 */
export function requiredConfirmation(input: {
  operation: WriteOperation;
  collection: string;
  touchesProduction: boolean;
  count?: number;
}) {
  const production = input.touchesProduction || PLATFORM_GLOBAL_COLLECTIONS.has(input.collection);
  const suffix = production ? " PRODUCAO" : "";
  if (input.operation === "bulk-update" || input.operation === "bulk-delete") return `${input.count ?? 0}${suffix}`;
  if (input.operation === "delete") return `EXCLUIR${suffix}`;
  return production ? "PRODUCAO" : null;
}

/** Whether a document belongs to a clinic in production (status "active"), by companyId or being the clinic itself. */
export function belongsToProduction(collection: string, document: Record<string, unknown> | null | undefined, liveCompanyIds: ReadonlySet<string>) {
  if (!document) return false;
  const owner = collection === "companies" ? document._id : document.companyId;
  return owner !== undefined && owner !== null && liveCompanyIds.has(String(owner));
}

export class ConfirmationRequired extends Error {
  constructor(readonly phrase: string, message: string) {
    super(message);
    this.name = "ConfirmationRequired";
  }
}

export function assertConfirmed(phrase: string | null, confirmation: string | undefined, message: string) {
  if (phrase && confirmation?.trim() !== phrase) throw new ConfirmationRequired(phrase, message);
}
