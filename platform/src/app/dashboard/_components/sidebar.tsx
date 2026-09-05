"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Activity, Bot, CalendarDays, ChevronLeft, ContactRound, LayoutDashboard, LogOut, Menu, SlidersHorizontal } from "lucide-react";
import { OriaLogo, OriaSymbol } from "@/components/oria-logo";
import { useEffect, useState, useCallback } from "react";

const navigationGroups = [
  { label: "Trabalho", items: [
    { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
    { href: "/dashboard/clientes", label: "Clientes", icon: ContactRound },
    { href: "/dashboard/calendario", label: "Calendário", icon: CalendarDays },
  ] },
  { label: "Inteligência", items: [
    { href: "/dashboard/fluxos", label: "Agent Studio", icon: Bot },
    { href: "/dashboard/operacoes", label: "Operações", icon: Activity },
  ] },
  { label: "Administração", items: [
    { href: "/dashboard/settings/system", label: "Configurações", icon: SlidersHorizontal },
  ] },
];

const LG_BREAKPOINT = 1024;

function isNavigationActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Desktop: open by default. Mobile: closed by default.
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Track viewport
  useEffect(() => {
    function check() {
      const mobile = window.innerWidth < LG_BREAKPOINT;
      setIsMobile(mobile);
    }
    const frame = window.requestAnimationFrame(() => {
      check();
      if (window.innerWidth >= LG_BREAKPOINT) setOpen(true);
    });

    window.addEventListener("resize", check);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", check);
    };
  }, []);

  // Close drawer on mobile route change
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (isMobile) setOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, isMobile]);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const sidebarInner = (
    <>
      {/* Logo row */}
      <div className="flex h-[72px] items-center justify-between px-5">
        <OriaLogo size="small" />
        <button
          onClick={() => setOpen(false)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone hover:bg-white/60 hover:text-slate-ink transition-colors"
          aria-label="Recolher menu"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
      </div>

      <nav aria-label="Navegação principal" className="space-y-5 px-3 pt-4">
        {navigationGroups.map((group) => <div key={group.label}><p className="px-3 pb-2 text-[10px] font-semibold uppercase text-stone">{group.label}</p><div className="space-y-0.5">{group.items.map((item) => {
          const isActive = isNavigationActive(pathname, item.href);
          return <Link key={item.href} href={item.href} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-white text-deep-teal shadow-sm ring-1 ring-mist/70" : "text-slate-ink/65 hover:bg-white/60 hover:text-slate-ink"}`}><item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-deep-teal" : "text-stone group-hover:text-slate-ink/75"}`} />{item.label}</Link>;
        })}</div></div>)}
      </nav>

      <div className="flex-1" />

      {/* User section + Logout */}
      <div className="border-t border-mist/60 p-4">
        <Link href="/dashboard/settings" className="flex items-center gap-3 rounded-lg bg-white/70 p-3 transition hover:bg-white">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-deep-teal text-xs font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-ink">
              {session?.user?.name || "Usuário"}
            </div>
            <div className="truncate text-xs text-stone">
              {session?.user?.email || ""}
            </div>
          </div>
        </Link>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-stone transition-colors hover:bg-white/60 hover:text-burnt-coral"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Sair
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* ── Top bar (always visible when sidebar is closed) ── */}
      <header
        className={`fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-mist bg-warm-sand/90 px-4 backdrop-blur-sm transition-opacity duration-200 ${
          open && !isMobile ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <button
          onClick={toggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-ink hover:bg-white/60 transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <OriaSymbol className="h-7 w-7" color="#0F766E" />
        <div className="w-9" />
      </header>

      {/* ── Overlay (mobile only, when open) ── */}
      {open && isMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-ink/30 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />
      )}

      {isMobile ? (
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-warm-sand/95 shadow-xl backdrop-blur-md transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}>
          {sidebarInner}
        </aside>
      ) : (
        <aside className={`flex h-screen shrink-0 flex-col overflow-hidden bg-warm-sand/60 shadow-[1px_0_0_0_theme(colors.mist)] transition-[width,opacity] duration-300 ease-in-out ${open ? "w-[260px]" : "w-0"}`}>
          <div className="flex h-full w-[260px] flex-col">{sidebarInner}</div>
        </aside>
      )}
    </>
  );
}
