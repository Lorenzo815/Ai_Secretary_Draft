// Payment method rules shared by the server, the AI tool and the settings screen (no database access).

/** What the payment link (Mercado Pago Checkout Pro) offers to the patient. */
export const PAYMENT_LINK_METHODS = ["credit_card", "debit_card", "ticket", "bank_transfer"] as const;
export type PaymentLinkMethod = typeof PAYMENT_LINK_METHODS[number];

export const PIX_EXPIRY_MINUTES = [15, 30, 60, 240, 720, 1440] as const;
export const LINK_EXPIRY_HOURS = [1, 6, 24, 48, 72, 168] as const;

export interface MercadoPagoSettings {
  /** Pix copy-and-paste code sent in the chat (Orders API). */
  pixInChat: boolean;
  /** Payment page link (Checkout Pro) for card, boleto and optionally Pix. */
  paymentLink: boolean;
  linkMethods: PaymentLinkMethod[];
  maxInstallments: number;
  pixExpiryMinutes: number;
  linkExpiryHours: number;
}

export const DEFAULT_MERCADO_PAGO_SETTINGS: MercadoPagoSettings = {
  pixInChat: true,
  paymentLink: false,
  linkMethods: ["credit_card", "debit_card"],
  maxInstallments: 1,
  pixExpiryMinutes: 60,
  linkExpiryHours: 24,
};

/** Methods the AI can offer right now: what the clinic enabled for its active provider. */
export function enabledPaymentMethods(configuration: { activeProvider: string; mercadoPago: MercadoPagoSettings }): Array<"pix" | "payment_link"> {
  if (configuration.activeProvider !== "mercado_pago") return ["pix"];
  return [
    ...(configuration.mercadoPago.pixInChat ? ["pix" as const] : []),
    ...(configuration.mercadoPago.paymentLink ? ["payment_link" as const] : []),
  ];
}

export function validateMercadoPagoSettings(input: unknown, current = DEFAULT_MERCADO_PAGO_SETTINGS): MercadoPagoSettings {
  if (input === undefined) return current;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Configuração do Mercado Pago inválida.");
  const value = { ...current, ...input as Partial<MercadoPagoSettings> };
  if (typeof value.pixInChat !== "boolean" || typeof value.paymentLink !== "boolean") throw new Error("Escolha os meios de pagamento.");
  if (!value.pixInChat && !value.paymentLink) throw new Error("Ative ao menos um meio: Pix no chat ou link de pagamento.");
  if (!Array.isArray(value.linkMethods) || value.linkMethods.some((method) => !PAYMENT_LINK_METHODS.includes(method))) {
    throw new Error("Meios do link de pagamento inválidos.");
  }
  const linkMethods = PAYMENT_LINK_METHODS.filter((method) => value.linkMethods.includes(method));
  if (value.paymentLink && linkMethods.length === 0) throw new Error("Escolha ao menos um meio para o link de pagamento.");
  if (!Number.isInteger(value.maxInstallments) || value.maxInstallments < 1 || value.maxInstallments > 12) {
    throw new Error("O número máximo de parcelas deve ser de 1 a 12.");
  }
  if (!PIX_EXPIRY_MINUTES.includes(value.pixExpiryMinutes as typeof PIX_EXPIRY_MINUTES[number])) throw new Error("Validade do Pix inválida.");
  if (!LINK_EXPIRY_HOURS.includes(value.linkExpiryHours as typeof LINK_EXPIRY_HOURS[number])) throw new Error("Validade do link inválida.");
  return {
    pixInChat: value.pixInChat, paymentLink: value.paymentLink, linkMethods,
    maxInstallments: value.maxInstallments, pixExpiryMinutes: value.pixExpiryMinutes, linkExpiryHours: value.linkExpiryHours,
  };
}
