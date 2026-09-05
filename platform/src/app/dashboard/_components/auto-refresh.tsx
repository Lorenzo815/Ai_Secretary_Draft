"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

export default function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    function refreshWhenIdle() {
      if (document.visibilityState !== "visible" || isEditing()) return;
      startTransition(() => router.refresh());
    }

    const interval = window.setInterval(refreshWhenIdle, intervalMs);
    document.addEventListener("visibilitychange", refreshWhenIdle);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenIdle);
    };
  }, [intervalMs, router]);

  return null;
}

function isEditing() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || active instanceof HTMLSelectElement
    || active instanceof HTMLElement && active.isContentEditable) return true;

  if (document.querySelector('[role="dialog"], [data-auto-refresh-dirty="true"]')) return true;

  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"))
    .some((control) => {
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
        return control.checked !== control.defaultChecked;
      }
      if (control instanceof HTMLSelectElement) {
        return Array.from(control.options).some((option) => option.selected !== option.defaultSelected);
      }
      return control.value !== control.defaultValue;
    });
}