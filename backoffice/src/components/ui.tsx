import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-ink/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, description, actions, children, className = "" }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-mist bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist px-5 py-4">
          <div>
            {title && <h2 className="font-heading text-base font-semibold text-slate-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-ink/55">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const tones = {
  teal: "bg-deep-teal/10 text-deep-teal ring-deep-teal/20",
  jade: "bg-soft-jade/25 text-forest-teal ring-soft-jade/40",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  gray: "bg-stone-100 text-stone-600 ring-stone-200",
  dark: "bg-night text-white ring-night",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-mist bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-ink/50">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold text-slate-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-ink/50">{hint}</p>}
    </div>
  );
}

export function StatusBadge({ status, isolationReady, legacy }: { status: string; isolationReady?: boolean; legacy?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {legacy && <Badge tone="dark">Produção</Badge>}
      <Badge tone={status === "active" ? "teal" : status === "test" ? "amber" : "red"}>
        {status === "active" ? "Ativa" : status === "test" ? "Teste" : status === "suspended" ? "Suspensa" : status}
      </Badge>
      {!legacy && <Badge tone={isolationReady ? "jade" : "gray"}>{isolationReady ? "Liberada" : "Bloqueada"}</Badge>}
    </span>
  );
}

export const inputClass = "h-10 w-full rounded-lg border border-mist bg-white px-3 text-sm outline-none transition focus:border-deep-teal focus:ring-2 focus:ring-deep-teal/15";
export const labelClass = "text-xs font-semibold text-slate-ink/70";
export const buttonClass = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-deep-teal px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-forest-teal disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButtonClass = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-mist bg-white px-4 text-sm font-semibold text-slate-ink transition hover:bg-soft-ivory disabled:cursor-not-allowed disabled:opacity-50";
export const dangerButtonClass = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";
