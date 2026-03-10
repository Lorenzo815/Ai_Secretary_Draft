"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/proposta", label: "Overview" },
  { href: "/proposta/visao-missao", label: "Visao e Missao" },
  { href: "/proposta/proposta-valor", label: "Proposta de Valor" },
  { href: "/proposta/diferenciais", label: "Diferenciais" },
  { href: "/proposta/recursos", label: "Recursos" },
  { href: "/proposta/arquitetura", label: "Arquitetura" }
];

export default function ProposalNav() {
  const pathname = usePathname();

  return (
    <nav className="subnav" aria-label="Proposal pages">
      {navItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={`pill ${active ? "active" : ""}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
