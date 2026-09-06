export const LEAD_QUALIFICATION_VERSION = 5 as const;

export type LeadInsightTagTone = "positive" | "attention" | "info" | "neutral";

export interface LeadInsightEvidenceReference {
  messageId: string;
  excerpt: string;
}

export interface LeadInsightTag {
  label: string;
  category: string;
  tone: LeadInsightTagTone;
  evidence: LeadInsightEvidenceReference[];
}