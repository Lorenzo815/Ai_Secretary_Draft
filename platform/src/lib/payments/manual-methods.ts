// Payments received outside the system and registered by staff in Financeiro (no database access).
export const MANUAL_PAYMENT_METHODS = ["cash", "card_machine", "pix_direct", "transfer", "insurance"] as const;
export type ManualPaymentMethod = typeof MANUAL_PAYMENT_METHODS[number];

export const MANUAL_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  cash: "Dinheiro",
  card_machine: "Maquininha de cartão",
  pix_direct: "Pix direto na conta",
  transfer: "Transferência",
  insurance: "Convênio",
};
