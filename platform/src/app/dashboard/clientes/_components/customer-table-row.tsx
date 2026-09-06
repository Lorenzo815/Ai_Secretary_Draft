"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export default function CustomerTableRow({
  href,
  customerName,
  children,
}: {
  href: string;
  customerName: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function openCustomer() {
    router.push(href);
  }

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(event.target)) return;
    openCustomer();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openCustomer();
  }

  return (
    <tr
      tabIndex={0}
      aria-label={`Abrir informações de ${customerName}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer transition hover:bg-soft-ivory/55 focus-visible:bg-soft-ivory/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-deep-teal"
    >
      {children}
    </tr>
  );
}

function isInteractiveTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea, summary, details, [role='button']"));
}