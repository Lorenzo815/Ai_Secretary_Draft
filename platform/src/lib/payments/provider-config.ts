import "server-only";

import type { Collection } from "mongodb";
import { withCurrentCompany, scopedSettingsId } from "../companies/context";
import { tenantDb } from "../companies/tenant-db";

export const PAYMENT_PROVIDERS = ["manual", "mercado_pago"] as const;
export type PaymentProvider = typeof PAYMENT_PROVIDERS[number];

export * from "./payment-methods";
import { DEFAULT_MERCADO_PAGO_SETTINGS, validateMercadoPagoSettings, type MercadoPagoSettings } from "./payment-methods";

export interface PaymentProviderConfiguration {
  _id: string;
  revision: number;
  activeProvider: PaymentProvider;
  humanFallbackEnabled: boolean;
  mercadoPago: MercadoPagoSettings;
  updatedAt: Date;
  updatedBy: string;
}

const DEFAULT_CONFIGURATION: PaymentProviderConfiguration = {
  _id: "active",
  revision: 1,
  activeProvider: "manual",
  humanFallbackEnabled: true,
  mercadoPago: DEFAULT_MERCADO_PAGO_SETTINGS,
  updatedAt: new Date(0),
  updatedBy: "system",
};

async function getCollection(): Promise<Collection<PaymentProviderConfiguration>> {
  return (await tenantDb()).collection("payment_provider_config");
}

export async function getPaymentProviderConfiguration(): Promise<PaymentProviderConfiguration> {
  const collection = await getCollection();
  const stored = await collection.findOne({ _id: await scopedSettingsId("active") });
  if (stored) {
    return { ...DEFAULT_CONFIGURATION, ...stored, mercadoPago: { ...DEFAULT_MERCADO_PAGO_SETTINGS, ...stored.mercadoPago } };
  }
  const initial = { ...DEFAULT_CONFIGURATION, _id: await scopedSettingsId("active"), updatedAt: new Date() };
  await collection.updateOne({ _id: await scopedSettingsId("active") }, { $setOnInsert: await withCurrentCompany(initial) }, { upsert: true });
  return initial;
}

export async function updatePaymentProviderConfiguration(input: {
  activeProvider: PaymentProvider;
  humanFallbackEnabled: boolean;
  mercadoPago?: unknown;
  updatedBy: string;
}) {
  if (!PAYMENT_PROVIDERS.includes(input.activeProvider)) throw new Error("Provedor de pagamento inválido.");
  const current = await getPaymentProviderConfiguration();
  const next: PaymentProviderConfiguration = {
    _id: await scopedSettingsId("active"),
    revision: current.revision + 1,
    activeProvider: input.activeProvider,
    humanFallbackEnabled: input.humanFallbackEnabled,
    mercadoPago: validateMercadoPagoSettings(input.mercadoPago, current.mercadoPago),
    updatedAt: new Date(),
    updatedBy: input.updatedBy,
  };
  await (await getCollection()).replaceOne({ _id: await scopedSettingsId("active") }, await withCurrentCompany(next), { upsert: true });
  return next;
}
