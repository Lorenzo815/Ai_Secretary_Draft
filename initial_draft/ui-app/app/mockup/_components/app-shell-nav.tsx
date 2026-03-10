"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href?: string;
  badge?: string;
};

const navItems: NavItem[] = [
  { label: "Home / Dashboard", href: "/mockup" },
  { label: "Conversas (Inbox)", href: "/mockup/inbox" },
  { label: "Flow Builder", href: "/mockup/flow-builder" },
  { label: "Templates" },
  { label: "Canais", href: "/mockup/canais" },
  { label: "Integracoes" },
  { label: "Analytics" },
  { label: "Custos", href: "/mockup/custos" },
  { label: "Knowledge Base (RAG)" },
  { label: "Configuracoes" },
  { label: "Billing / Plano", href: "/mockup/billing" },
  { label: "Team & Roles (RBAC)", badge: "Pro" },
  { label: "Marketplace", badge: "Q4" }
];

export default function AppShellNav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav" aria-label="Main app navigation">
      {navItems.map((item) => {
        if (!item.href) {
          return (
            <span key={item.label} className="app-nav-item is-disabled">
              {item.label}
              {item.badge ? <small>{item.badge}</small> : null}
            </span>
          );
        }

        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={`app-nav-item ${active ? "is-active" : ""}`}>
            {item.label}
            {item.badge ? <small>{item.badge}</small> : null}
          </Link>
        );
      })}
    </nav>
  );
}
