"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Qualification {
  generatedAt: string;
  model: string;
  profileContext: {
    ageYears: number;
    neighborhood: string;
    city: string;
    state: string;
  };
    profileFit: {
      level: "high" | "medium" | "low" | "insufficient_data";
      score: number;
      confidence: "high" | "medium" | "low";
      rationale: string;
    };
    combinedFit: {
    level: "high" | "medium" | "low" | "insufficient_data";
    score: number;
    confidence: "high" | "medium" | "low";
    rationale: string;
  };
  explicitSignals: {
    schedulingIntent: "strong" | "moderate" | "weak" | "unknown";
    priceSentiment: "positive" | "neutral" | "concerned" | "negative" | "unknown";
    engagement: "high" | "medium" | "low";
    evidence: Array<{ signal: string; observation: string }>;
  };
  logistics: {
    clinicCity: string;
    customerCity: string;
    customerNeighborhood: string;
    distanceReference: string;
    proximity: "same_city" | "nearby" | "regional" | "distant" | "unknown";
    estimatedDistanceKm: number | null;
    confidence: "high" | "medium" | "low";
    rationale: string;
  };
  occupationMarketBenchmark: {
    profession: string;
    geographyBasis: string;
    estimatedMonthlyGrossRangeBRL: { min: number; max: number } | null;
    confidence: "high" | "medium" | "low";
    rationale: string;
    caveats: string[];
  };
  strengths: string[];
  frictions: string[];
  openQuestions: string[];
  recommendedApproach: string;
  reasoningSummary: string;
  limitations: string[];
}

export default function LeadQualificationPanel({
  customerId,
  qualification,
}: {
  customerId: string;
  qualification: Qualification | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshQualification() {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/customers/${customerId}/qualification`, { method: "POST" });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "Não foi possível atualizar a análise.");
    else router.refresh();
    setLoading(false);
  }

  return (
    <section aria-labelledby="lead-qualification-title" className="rounded-lg border border-mist bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-stone">Leitura comercial</p>
          <h2 id="lead-qualification-title" className="mt-1 font-heading text-lg font-semibold text-slate-ink">Qualificação do lead</h2>
        </div>
        <button
          type="button"
          onClick={refreshQualification}
          disabled={loading}
          className="rounded-lg border border-deep-teal px-3 py-2 text-xs font-semibold text-deep-teal hover:bg-deep-teal hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? "Analisando..." : qualification ? "Atualizar análise" : "Gerar análise"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-burnt-coral">{error}</p>}
      {!qualification ? (
        <p className="mt-4 text-sm text-stone">A análise será gerada quando o cadastro estiver completo.</p>
      ) : (
        <div className="mt-5 space-y-6">
            <div className="grid overflow-hidden rounded-lg border border-mist sm:grid-cols-2">
              <FitScore
                label="Fit do cadastro"
                score={qualification.profileFit.score}
                level={qualification.profileFit.level}
                confidence={qualification.profileFit.confidence}
                rationale={qualification.profileFit.rationale}
              />
              <FitScore
                label="Fit + intenção"
                score={qualification.combinedFit.score}
                level={qualification.combinedFit.level}
                confidence={qualification.combinedFit.confidence}
                rationale={qualification.combinedFit.rationale}
                accent
              />
            </div>
            <p className="text-[11px] leading-5 text-stone">Indicadores para leitura comercial humana. Não definem acesso, prioridade clínica ou tratamento.</p>

          <div className="flex flex-wrap gap-x-8 gap-y-3 border-y border-mist py-3 text-xs">
            <ContextFact label="Idade" value={`${qualification.profileContext.ageYears} anos`} />
            <ContextFact label="Bairro" value={qualification.profileContext.neighborhood || "Não informado"} />
            <ContextFact label="Cidade" value={`${qualification.profileContext.city}/${qualification.profileContext.state}`} />
            <p className="basis-full text-[11px] text-stone">Contexto factual, não utilizado no score nem como proxy de renda.</p>
          </div>
          <div className="grid border-y border-mist sm:grid-cols-3">
            <Metric label="Intenção de agendar" value={intentLabel(qualification.explicitSignals.schedulingIntent)} detail={`engajamento ${engagementLabel(qualification.explicitSignals.engagement)}`} />
            <Metric label="Sinal sobre preço" value={priceLabel(qualification.explicitSignals.priceSentiment)} detail="somente manifestação explícita" />
            <Metric label="Logística" value={proximityLabel(qualification.logistics.proximity)} detail={qualification.logistics.estimatedDistanceKm === null ? "distância não estimada" : `aprox. ${Math.round(qualification.logistics.estimatedDistanceKm)} km`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-ink">Raciocínio da análise</h3>
              <p className="mt-2 text-sm leading-6 text-slate-ink/80">{qualification.reasoningSummary}</p>
              <p className="mt-3 text-sm leading-6 text-stone">{qualification.combinedFit.rationale}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-ink">Benchmark da profissão</h3>
              <p className="mt-2 font-heading text-xl font-bold text-slate-ink">{formatMarketRange(qualification.occupationMarketBenchmark.estimatedMonthlyGrossRangeBRL)}</p>
              <p className="mt-1 text-xs text-stone">Faixa bruta mensal de mercado · {qualification.occupationMarketBenchmark.geographyBasis}</p>
              <p className="mt-3 text-sm leading-6 text-slate-ink/80">{qualification.occupationMarketBenchmark.rationale}</p>
              <p className="mt-2 text-xs font-semibold text-burnt-coral">Não representa a renda do paciente e não participa do score.</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <AnalysisList title="Pontos favoráveis" items={qualification.strengths} empty="Nenhum sinal favorável suficiente." />
            <AnalysisList title="Fricções observadas" items={qualification.frictions} empty="Nenhuma fricção explícita." />
            <AnalysisList title="Perguntas em aberto" items={qualification.openQuestions} empty="Nenhuma pergunta relevante em aberto." />
          </div>

          <div className="border-l-2 border-deep-teal bg-soft-ivory px-4 py-3">
            <p className="text-xs font-semibold uppercase text-stone">Próxima abordagem sugerida</p>
            <p className="mt-1 text-sm leading-6 text-slate-ink">{qualification.recommendedApproach}</p>
          </div>

          <p className="text-xs leading-5 text-stone"><strong className="text-slate-ink">Referência logística:</strong> {qualification.logistics.distanceReference} {qualification.logistics.rationale}</p>

          {qualification.explicitSignals.evidence.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-ink">Evidências utilizadas</h3>
              <div className="mt-3 divide-y divide-mist border-y border-mist">
                {qualification.explicitSignals.evidence.map((evidence, index) => (
                  <div key={`${evidence.signal}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
                    <p className="text-xs font-semibold text-slate-ink">{formatSignal(evidence.signal)}</p>
                    <p className="text-xs leading-5 text-stone">{evidence.observation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <details className="border-t border-mist pt-4 text-xs text-stone">
            <summary className="cursor-pointer font-semibold text-slate-ink">Limitações e ressalvas</summary>
            <ul className="mt-3 space-y-2">
              {[...qualification.occupationMarketBenchmark.caveats, ...qualification.limitations].map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}
            </ul>
          </details>
          <p className="text-[11px] text-stone">Gerada em {formatDateTime(qualification.generatedAt)} · modelo {qualification.model} · análise para revisão humana</p>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="border-b border-mist px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="text-xs font-semibold uppercase text-stone">{label}</p><p className="mt-1 font-heading text-lg font-bold text-slate-ink">{value}</p><p className="mt-1 text-xs text-stone">{detail}</p></div>;
}

function FitScore({
  label,
  score,
  level,
  confidence,
  rationale,
  accent = false,
}: {
  label: string;
  score: number;
  level: Qualification["profileFit"]["level"];
  confidence: "high" | "medium" | "low";
  rationale: string;
  accent?: boolean;
}) {
  return (
    <div className={`p-5 sm:p-6 sm:first:border-r sm:first:border-mist ${accent ? "bg-deep-teal text-white" : "bg-soft-ivory text-slate-ink"}`}>
      <p className={`text-xs font-semibold uppercase ${accent ? "text-white/70" : "text-stone"}`}>{label}</p>
      <div className="mt-2 flex items-end gap-2">
        <p className="font-heading text-4xl font-bold leading-none">{score}</p>
        <p className={`pb-0.5 text-sm font-semibold ${accent ? "text-white/70" : "text-stone"}`}>/100</p>
      </div>
      <p className={`mt-2 text-xs font-semibold ${accent ? "text-white/80" : "text-deep-teal"}`}>{readinessLabel(level)} · confiança {confidenceLabel(confidence)}</p>
      <p className={`mt-3 text-xs leading-5 ${accent ? "text-white/75" : "text-stone"}`}>{rationale}</p>
    </div>
  );
}

function ContextFact({ label, value }: { label: string; value: string }) {
  return <p><span className="font-semibold text-stone">{label}</span><br /><strong className="mt-0.5 inline-block text-sm text-slate-ink">{value}</strong></p>;
}

function AnalysisList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <div><h3 className="text-sm font-semibold text-slate-ink">{title}</h3><ul className="mt-3 space-y-2 text-sm leading-5 text-stone">{items.length > 0 ? items.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>) : <li>{empty}</li>}</ul></div>;
}

function formatMarketRange(range: { min: number; max: number } | null) {
  if (!range) return "Faixa indisponível";
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  return `${currency.format(range.min)} – ${currency.format(range.max)}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function readinessLabel(value: Qualification["profileFit"]["level"]) {
  return ({ high: "Alta", medium: "Média", low: "Baixa", insufficient_data: "Dados insuficientes" })[value];
}
function confidenceLabel(value: "high" | "medium" | "low") { return ({ high: "alta", medium: "média", low: "baixa" })[value]; }
function intentLabel(value: Qualification["explicitSignals"]["schedulingIntent"]) { return ({ strong: "Forte", moderate: "Moderada", weak: "Fraca", unknown: "Não identificada" })[value]; }
function engagementLabel(value: Qualification["explicitSignals"]["engagement"]) { return ({ high: "alto", medium: "médio", low: "baixo" })[value]; }
function priceLabel(value: Qualification["explicitSignals"]["priceSentiment"]) { return ({ positive: "Positivo", neutral: "Neutro", concerned: "Com ressalvas", negative: "Negativo", unknown: "Não identificado" })[value]; }
function proximityLabel(value: Qualification["logistics"]["proximity"]) { return ({ same_city: "Mesma cidade", nearby: "Próxima", regional: "Regional", distant: "Distante", unknown: "Não estimada" })[value]; }
function formatSignal(value: string) {
  const label = value.replaceAll("_", " ").trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : "Sinal observado";
}