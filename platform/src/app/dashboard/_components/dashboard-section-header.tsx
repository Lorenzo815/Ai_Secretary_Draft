import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  titleId,
  meta,
  control,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  titleId: string;
  meta?: string;
  control?: ReactNode;
}) {
  return (
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal text-white">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase text-deep-teal">{eyebrow}</p>
          <h2 id={titleId} className="mt-1 font-heading text-xl font-semibold text-slate-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone">{description}</p>
        </div>
      </div>
      {control ?? (meta && <p className="shrink-0 text-xs font-semibold text-stone">{meta}</p>)}
    </header>
  );
}

export function PanelHeader({
  icon: Icon,
  eyebrow,
  title,
  titleId,
  meta,
  action,
  tone = "teal",
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  titleId?: string;
  meta?: string;
  action?: { href: string; label: string };
  tone?: "teal" | "coral";
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tone === "coral" ? "bg-burnt-coral/10 text-burnt-coral" : "bg-deep-teal/10 text-deep-teal"}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase text-stone">{eyebrow}</p>
          <h3 id={titleId} className="mt-1 font-heading text-base font-semibold text-slate-ink">{title}</h3>
        </div>
      </div>
      {action ? (
        <Link href={action.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-deep-teal hover:text-forest-teal">
          {action.label}<ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : meta ? <p className="shrink-0 text-xs font-semibold text-stone">{meta}</p> : null}
    </header>
  );
}