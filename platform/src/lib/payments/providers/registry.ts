import "server-only";

import { mercadoPagoProvider } from "./mercado-pago";

export function getAutomaticPaymentProvider(provider: "mercado_pago") {
  if (provider === "mercado_pago") return mercadoPagoProvider;
  throw new Error(`Provedor automático não implementado: ${provider}`);
}