"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ActivityPoint {
  date: string;
  label: string;
  inbound: number;
  outbound: number;
}

interface FunnelPoint {
  key: string;
  label: string;
  count: number;
}

interface LeadFitPoint {
  date: string;
  label: string;
  profileFit: number | null;
  combinedFit: number | null;
  leadCount: number;
}

export default function OverviewCharts({
  activity,
  funnel,
  leadFit,
}: {
  activity: ActivityPoint[];
  funnel: FunnelPoint[];
  leadFit: LeadFitPoint[];
}) {
  const hasActivity = activity.some((point) => point.inbound + point.outbound > 0);
  const hasFunnel = funnel.some((point) => point.count > 0);
  const hasLeadFit = leadFit.some((point) => point.leadCount > 0);
  const latestLeadFit = leadFit.findLast((point) => point.leadCount > 0);

  return (
    <section aria-label="Análises da jornada" className="grid gap-7 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="border-y border-mist py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-stone">Ritmo das conversas</p>
            <h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Atividade nos últimos 14 dias</h2>
          </div>
          <div className="flex gap-4 text-xs text-stone" aria-label="Legenda">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-deep-teal" />Recebidas</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-burnt-coral" />Enviadas</span>
          </div>
        </div>
        <div className="mt-5 h-64 w-full">
          {hasActivity ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="inbound-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0F766E" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#0F766E" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="outbound-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E76F51" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#E76F51" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#E7E5E4" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} />
                <Tooltip contentStyle={{ border: "1px solid #E7E5E4", borderRadius: 6, boxShadow: "0 10px 24px rgba(31,41,55,.08)", fontSize: 12 }} labelStyle={{ color: "#1F2937", fontWeight: 700 }} />
                <Area type="monotone" dataKey="inbound" name="Recebidas" stroke="#0F766E" strokeWidth={2} fill="url(#inbound-fill)" />
                <Area type="monotone" dataKey="outbound" name="Enviadas" stroke="#E76F51" strokeWidth={2} fill="url(#outbound-fill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart text="A atividade diária aparecerá após as primeiras conversas." />
          )}
        </div>
      </div>

      <div className="border-y border-mist py-5">
        <div>
          <p className="text-xs font-semibold uppercase text-stone">Jornada comercial</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Etapas concluídas pela coorte de 30 dias</h2>
        </div>
        <div className="mt-5 h-64 w-full">
          {hasFunnel ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 22, left: 18, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#E7E5E4" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={112} axisLine={false} tickLine={false} tick={{ fill: "#57534E", fontSize: 11 }} />
                <Tooltip cursor={{ fill: "#F5EFE6" }} contentStyle={{ border: "1px solid #E7E5E4", borderRadius: 6, fontSize: 12 }} />
                <Bar dataKey="count" name="Clientes" fill="#0F766E" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart text="O funil será formado conforme novos contatos avançarem." />
          )}
        </div>
      </div>

      <div className="border-y border-mist py-5 xl:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-stone">Qualidade dos leads</p>
            <h2 className="mt-1 font-heading text-lg font-semibold text-slate-ink">Evolução dos scores nos últimos 30 dias</h2>
            <p className="mt-1 text-xs text-stone">Média diária; cada lead conta uma vez por dia.</p>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3" aria-label="Últimos scores de fit">
            <div>
              <p className="flex items-center gap-1.5 text-xs text-stone"><i className="h-0.5 w-4 bg-burnt-coral" />Fit do cadastro</p>
              <p className="mt-1 font-heading text-2xl font-bold text-slate-ink">{latestLeadFit?.profileFit ?? "—"}<span className="text-xs font-semibold text-stone">/100</span></p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-stone"><i className="h-0.5 w-4 bg-deep-teal" />Fit + intenção</p>
              <p className="mt-1 font-heading text-2xl font-bold text-slate-ink">{latestLeadFit?.combinedFit ?? "—"}<span className="text-xs font-semibold text-stone">/100</span></p>
            </div>
            {latestLeadFit && <p className="pb-1 text-xs text-stone">{latestLeadFit.leadCount} lead(s) em {latestLeadFit.label}</p>}
          </div>
        </div>
        <div className="mt-5 h-72 w-full">
          {hasLeadFit ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={leadFit} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#E7E5E4" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={{ fill: "#78716C", fontSize: 11 }} />
                <Tooltip contentStyle={{ border: "1px solid #E7E5E4", borderRadius: 6, boxShadow: "0 10px 24px rgba(31,41,55,.08)", fontSize: 12 }} labelStyle={{ color: "#1F2937", fontWeight: 700 }} />
                <Line type="monotone" dataKey="profileFit" name="Fit do cadastro" stroke="#E76F51" strokeWidth={2.5} connectNulls dot={{ r: 5, fill: "#fff", strokeWidth: 2.5 }} activeDot={{ r: 7 }}>
                  <LabelList dataKey="profileFit" position="left" fill="#C25138" fontSize={12} fontWeight={700} />
                </Line>
                <Line type="monotone" dataKey="combinedFit" name="Fit + intenção" stroke="#0F766E" strokeWidth={2.5} connectNulls dot={{ r: 5, fill: "#fff", strokeWidth: 2.5 }} activeDot={{ r: 7 }}>
                  <LabelList dataKey="combinedFit" position="left" fill="#0F766E" fontSize={12} fontWeight={700} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart text="A evolução aparecerá após as primeiras qualificações com os novos scores." />
          )}
        </div>
      </div>
    </section>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center border-y border-dashed border-mist px-5 text-center text-sm text-stone">
      {text}
    </div>
  );
}
