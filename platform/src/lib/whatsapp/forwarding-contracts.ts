export const FORWARDING_ENDPOINT_LIMIT = 5;
export const FORWARDING_MAX_RETRIES = 10;
export const FORWARDING_DEFAULT_RETRIES = 3;

export interface ForwardingEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  maxRetries: number;
}

export type ForwardingDeliveryStatus = "pending" | "processing" | "delivered" | "failed" | "cancelled";

export interface ForwardingResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
}

export type ForwardingKind = "whatsapp" | "calendar";

export interface ForwardingCounts {
  delivered: number;
  failed: number;
}

/** Final outcomes of real (non-test) deliveries, summed over every destination of one kind. */
export interface ForwardingStats {
  last24Hours: ForwardingCounts;
  last7Days: ForwardingCounts;
  last30Days: ForwardingCounts;
}

export interface ForwardingSettings {
  revision: number;
  endpoints: ForwardingEndpoint[];
  stats: ForwardingStats;
}
