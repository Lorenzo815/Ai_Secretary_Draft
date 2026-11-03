"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";
import { Building2, Database, Eraser, History, LayoutDashboard, LogOut, Settings2 } from "lucide-react";

const links = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/companies", label: "Clínicas", icon: Building2 },
  { href: "/data", label: "Dados", icon: Database },
  { href: "/cleanup", label: "Limpeza", icon: Eraser },
  { href: "/settings", label: "Oria", icon: Settings2 },
  { href: "/audit", label: "Auditoria", icon: History },
];

export function Sidebar({ owner }: { owner: string }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-full shrink-0 flex-col bg-night text-white lg:sticky lg:top-0 lg:h-screen lg:w-60">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-soft-jade/15 text-soft-jade">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 4a8 8 0 1 0 8 8" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <div>
          <p className="font-heading text-sm font-semibold">Oria Backoffice</p>
          <p className="text-[11px] text-white/45">Somente equipe Oria</p>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 lg:flex-col">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
              <Icon className={`h-4 w-4 ${active ? "text-soft-jade" : ""}`} />{label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden border-t border-white/10 px-5 py-4 lg:block">
        <p className="truncate text-xs text-white/60" title={owner}>{owner}</p>
        <form action={logoutAction}>
          <button className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-white/70 hover:text-white">
            <LogOut className="h-3.5 w-3.5" />Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
