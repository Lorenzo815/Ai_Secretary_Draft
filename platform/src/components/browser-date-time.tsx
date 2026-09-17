"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => undefined;
}

export default function BrowserDateTime({
  value,
  dateStyle = "short",
  timeStyle = "short",
  className,
}: {
  value: string;
  dateStyle?: "full" | "long" | "medium" | "short" | null;
  timeStyle?: "full" | "long" | "medium" | "short" | null;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const formatter = hydrated ? new Intl.DateTimeFormat("pt-BR", {
    ...(dateStyle ? { dateStyle } : {}),
    ...(timeStyle ? { timeStyle } : {}),
  }) : null;
  const timeZone = formatter?.resolvedOptions().timeZone;

  return (
    <time dateTime={value} className={className} title={timeZone ? `Horário do navegador: ${timeZone}` : undefined}>
      {formatter ? formatter.format(new Date(value)) : "—"}
    </time>
  );
}