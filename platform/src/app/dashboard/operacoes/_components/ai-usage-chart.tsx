"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface UsagePoint {
  date: string;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export default function AiUsageChart({ data }: { data: UsagePoint[] }) {
  const hasUsage = data.some((point) => point.inputTokens + point.cachedInputTokens + point.outputTokens > 0);

  if (!hasUsage) {
    return (
      <div className="flex h-full items-center justify-center border-y border-dashed border-mist px-5 text-center text-sm text-stone">
        O consumo diário aparecerá após as primeiras chamadas com métricas disponíveis.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#E7E5E4" strokeDasharray="3 3" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} tickFormatter={formatCompactNumber} />
        <Tooltip
          contentStyle={{ border: "1px solid #E7E5E4", borderRadius: 6, boxShadow: "0 10px 24px rgba(31,41,55,.08)", fontSize: 12 }}
          formatter={(value) => formatTokens(Number(value))}
          labelStyle={{ color: "#1F2937", fontWeight: 700 }}
        />
        <Bar dataKey="inputTokens" name="Entrada nova" stackId="usage" fill="#0F766E" maxBarSize={34} />
        <Bar dataKey="cachedInputTokens" name="Entrada em cache" stackId="usage" fill="#D2A84A" maxBarSize={34} />
        <Bar dataKey="outputTokens" name="Saída" stackId="usage" fill="#E76F51" radius={[3, 3, 0, 0]} maxBarSize={34} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTokens(value: number) {
  return `${new Intl.NumberFormat("pt-BR").format(value)} tokens`;
}