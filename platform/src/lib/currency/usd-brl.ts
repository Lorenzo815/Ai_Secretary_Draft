import "server-only";

const USD_BRL_URL = "https://api.frankfurter.app/latest?base=USD&symbols=BRL";

export interface UsdBrlRate {
  rate: number;
  date: string;
  source: "Frankfurter";
}

export async function getUsdBrlRate(): Promise<UsdBrlRate | undefined> {
  try {
    const response = await fetch(USD_BRL_URL, {
      cache: "force-cache",
      next: { revalidate: 3_600 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    return parseUsdBrlRate(await response.json());
  } catch {
    return undefined;
  }
}

export function parseUsdBrlRate(value: unknown): UsdBrlRate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as { date?: unknown; rates?: { BRL?: unknown } };
  const rate = typeof result.rates?.BRL === "number" ? result.rates.BRL : Number(result.rates?.BRL);
  if (!Number.isFinite(rate) || rate <= 0 || typeof result.date !== "string") return undefined;
  return { rate, date: result.date, source: "Frankfurter" };
}