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

export interface ForwardingSettings {
  revision: number;
  endpoints: ForwardingEndpoint[];
  deliveries: Array<{
    id: string;
    endpointId: string;
    endpointName: string;
    status: ForwardingDeliveryStatus;
    attempts: number;
    maxRetries: number;
    lastStatus: number | null;
    lastError: string | null;
    createdAt: string;
    nextAttemptAt: string | null;
    isTest: boolean;
  }>;
}
