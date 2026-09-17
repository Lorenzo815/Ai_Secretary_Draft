import "server-only";

import type { Collection } from "mongodb";
import clientPromise from "../mongodb";

export const PAYMENT_PROVIDERS = ["manual", "mercado_pago"] as const;
export type PaymentProvider = typeof PAYMENT_PROVIDERS[number];

export interface PaymentProviderConfiguration {
  _id: "active";
  revision: number;
  activeProvider: PaymentProvider;
  humanFallbackEnabled: boolean;
  updatedAt: Date;
  updatedBy: string;
}

const DEFAULT_CONFIGURATION: PaymentProviderConfiguration = {
  _id: "active",
  revision: 1,
  activeProvider: "manual",
  humanFallbackEnabled: true,
  updatedAt: new Date(0),
  updatedBy: "system",
};

async function getCollection(): Promise<Collection<PaymentProviderConfiguration>> {
  return (await clientPromise).db("ai_secretary").collection("payment_provider_config");
}

export async function getPaymentProviderConfiguration() {
  const collection = await getCollection();
  const stored = await collection.findOne({ _id: "active" });
  if (stored) return { ...DEFAULT_CONFIGURATION, ...stored };
  const initial = { ...DEFAULT_CONFIGURATION, updatedAt: new Date() };
  await collection.updateOne({ _id: "active" }, { $setOnInsert: initial }, { upsert: true });
  return initial;
}

export async function updatePaymentProviderConfiguration(input: {
  activeProvider: PaymentProvider;
  humanFallbackEnabled: boolean;
  updatedBy: string;
}) {
  if (!PAYMENT_PROVIDERS.includes(input.activeProvider)) throw new Error("Provedor de pagamento inválido.");
  const current = await getPaymentProviderConfiguration();
  const next: PaymentProviderConfiguration = {
    _id: "active",
    revision: current.revision + 1,
    activeProvider: input.activeProvider,
    humanFallbackEnabled: input.humanFallbackEnabled,
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  };
  await (await getCollection()).replaceOne({ _id: "active" }, next, { upsert: true });
  return next;
}