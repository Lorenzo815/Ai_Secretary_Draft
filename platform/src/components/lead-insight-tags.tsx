import type { LeadInsightTag, LeadInsightTagTone } from "@/lib/qualification/contracts";

const toneStyles: Record<LeadInsightTagTone, string> = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  neutral: "border-stone-200 bg-stone-50 text-stone-700",
};

export default function LeadInsightTags({
  tags,
  limit,
  compact = false,
  expandable = false,
}: {
  tags: LeadInsightTag[];
  limit?: number;
  compact?: boolean;
  expandable?: boolean;
}) {
  const visibleTags = typeof limit === "number" ? tags.slice(0, limit) : tags;
  const hiddenTags = typeof limit === "number" ? tags.slice(limit) : [];
  if (visibleTags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Sinais da qualificação">
      <TagList tags={visibleTags} compact={compact} />
      {expandable && hiddenTags.length > 0 && (
        <details className="group contents">
          <summary className="order-last cursor-pointer list-none rounded-full border border-mist bg-white px-2 py-1 text-[11px] font-semibold leading-4 text-deep-teal hover:border-deep-teal">
            <span className="group-open:hidden">+{hiddenTags.length} tags</span>
            <span className="hidden group-open:inline">Ocultar</span>
          </summary>
          <div className="contents">
            <TagList tags={hiddenTags} compact={compact} offset={visibleTags.length} />
          </div>
        </details>
      )}
    </div>
  );
}

function TagList({ tags, compact, offset = 0 }: { tags: LeadInsightTag[]; compact: boolean; offset?: number }) {
  return tags.map((tag, index) => {
    const evidence = formatEvidence(tag.evidence);
    const category = formatDisplayText(tag.category);
    const label = formatDisplayText(tag.label);
    return (
    <span
      key={`${tag.category}-${tag.label}-${index + offset}`}
      title={evidence}
      aria-label={`${category}: ${label}. Evidência: ${evidence}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold leading-4 ${toneStyles[tag.tone]}`}
    >
      {!compact && <span className="font-medium opacity-70">{category} ·</span>}
      <span className="whitespace-normal">{label}</span>
    </span>
    );
  });
}

function formatEvidence(evidence: LeadInsightTag["evidence"] | string) {
  if (typeof evidence === "string") return evidence;
  return evidence.map((reference) => `“${reference.excerpt}”`).join(" · ");
}

function formatDisplayText(value: string) {
  const normalized = value.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.charAt(0).toLocaleUpperCase("pt-BR") + normalized.slice(1) : value;
}