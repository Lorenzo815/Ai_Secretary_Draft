import type { ObjectId } from "mongodb";

export interface CreateProviderPaymentInput {
  paymentRequestId: ObjectId;
  amountCents: number;
  payerEmail: string;
  description: string;
}

export interface ProviderPayment {
  externalPaymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
}

export interface VerifiedProviderPayment {
  externalPaymentId: string;
  externalReference: string;
  amountCents: number;
  currency: string;
  status: string;
}

export interface PaymentProviderAdapter {
  createPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment>;
  getPayment(externalPaymentId: string): Promise<VerifiedProviderPayment>;
}