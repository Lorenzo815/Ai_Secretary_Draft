import type { ObjectId } from "mongodb";
import type { PaymentLinkMethod } from "../provider-config";

export interface PixChargeInput {
  paymentRequestId: ObjectId;
  amountCents: number;
  payerEmail: string;
  /** Sent to Mercado Pago to help its anti-fraud checks (in sandbox, "APRO" approves automatically). */
  payerFirstName?: string;
  description: string;
  expiryMinutes: number;
}

export interface PixCharge {
  orderId: string;
  status: string;
  qrCode: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  expiresAt?: Date;
}

export interface PaymentLinkInput {
  paymentRequestId: ObjectId;
  amountCents: number;
  payerEmail: string;
  description: string;
  methods: PaymentLinkMethod[];
  maxInstallments: number;
  expiresAt: Date;
  notificationUrl?: string;
}

export interface PaymentLink {
  preferenceId: string;
  url: string;
  expiresAt: Date;
}

export interface MercadoPagoOrder {
  orderId: string;
  externalReference: string;
  amountCents: number;
  currency: string;
  status: string;
  statusDetail: string;
}

/** A single payment attempt as Mercado Pago records it (card, Pix, boleto, account money). */
export interface MercadoPagoPayment {
  paymentId: string;
  externalReference: string;
  amountCents: number;
  paidAmountCents: number;
  netReceivedCents: number | null;
  feeCents: number | null;
  currency: string;
  status: string;
  statusDetail: string;
  paymentType: string;
  paymentMethod: string;
  installments: number | null;
  payerEmail: string | null;
  createdAt: Date | null;
  approvedAt: Date | null;
  liveMode: boolean | null;
}
