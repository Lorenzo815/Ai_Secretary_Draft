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
  return active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || active instanceof HTMLSelectElement
    || Boolean(document.querySelector('[role="dialog"]'));
}