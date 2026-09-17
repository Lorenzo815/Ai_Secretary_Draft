"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface UsagePoint {
  date: string;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

type Range = "24h" | "7d" | "30d";

export default function AiUsageChart({ hourly, daily }: { hourly: UsagePoint[]; daily: UsagePoint[] }) {
  const [range, setRange] = useState<Range>("7d");
  const data = range === "24h" ? hourly : range === "7d" ? daily.slice(-7) : daily;
  const hasUsage = data.some((point) => point.inputTokens + point.cachedInputTokens + point.outputTokens > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-stone">{range === "24h" ? "Agregado por hora" : "Agregado por dia"}</p>
        <div className="inline-flex rounded-md border border-mist bg-white p-0.5" aria-label="Período do gráfico">
          {(["24h", "7d", "30d"] as const).map((option) => (
            <button key={option} type="button" onClick={() => setRange(option)} aria-pressed={range === option} className={`min-w-12 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${range === option ? "bg-slate-ink text-white" : "text-stone hover:text-slate-ink"}`}>
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {hasUsage ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 10, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#E7E5E4" strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis yAxisId="tokens" axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} tickFormatter={formatCompactNumber} />
              <YAxis yAxisId="cost" orientation="right" axisLine={false} tickLine={false} width={62} tick={{ fill: "#2563EB", fontSize: 11 }} tickFormatter={formatCompactCost} />
              <Tooltip contentStyle={{ border: "1px solid #E7E5E4", borderRadius: 6, boxShadow: "0 10px 24px rgba(31,41,55,.08)", fontSize: 12 }} formatter={(value, name) => name === "Custo estimado" ? formatCost(Number(value)) : formatTokens(Number(value))} labelStyle={{ color: "#1F2937", fontWeight: 700 }} />
              <Bar yAxisId="tokens" dataKey="inputTokens" name="Entrada nova" stackId="usage" fill="#0F766E" maxBarSize={34} />
              <Bar yAxisId="tokens" dataKey="cachedInputTokens" name="Entrada em cache" stackId="usage" fill="#D2A84A" maxBarSize={34} />
              <Bar yAxisId="tokens" dataKey="outputTokens" name="Saída" stackId="usage" fill="#E76F51" radius={[3, 3, 0, 0]} maxBarSize={34} />
              <Line yAxisId="cost" type="monotone" dataKey="estimatedCostUsd" name="Custo estimado" stroke="#2563EB" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center border-y border-dashed border-mist px-5 text-center text-sm text-stone">
            Nenhuma chamada com métricas neste período.
          </div>
        )}
      </div>
    </div>
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTokens(value: number) {
  return `${new Intl.NumberFormat("pt-BR").format(value)} tokens`;
}

function formatCompactCost(value: number) {
  return `US$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value)}`;
}

function formatCost(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(value);
}