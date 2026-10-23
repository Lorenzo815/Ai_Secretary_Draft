"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Activity, Bot, Building2, CalendarDays, ChevronLeft, ContactRound, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquareText, Settings2, SlidersHorizontal } from "lucide-react";
import { OriaLogo, OriaSymbol } from "@/components/oria-logo";
import { useEffect, useState, useCallback } from "react";
import { allows, pagePolicy } from "@/lib/access/policy";

const navigationGroups = [
  { label: "Trabalho", items: [
    { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
    { href: "/dashboard/conversas", label: "Conversas", icon: MessageCircle },
    { href: "/dashboard/clientes", label: "Clientes", icon: ContactRound },
    { href: "/dashboard/calendario", label: "Calendário", icon: CalendarDays },
  ] },
  { label: "Inteligência", items: [
    { href: "/dashboard/fluxos", label: "Agent Studio", icon: Bot },
    { href: "/dashboard/operacoes", label: "Operações", icon: Activity },
  ] },
  { label: "Administração", items: [
    { href: "/dashboard/whatsapp", label: "Modelos WhatsApp", icon: MessageSquareText },
    { href: "/dashboard/settings/system", label: "Sistema", icon: SlidersHorizontal },
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
  const visibleGroups = navigationGroups.map(group => ({
    ...group,
    items: group.items.filter(item => session?.principal && allows(session.principal, pagePolicy(item.href))),
  })).filter(group => group.items.length > 0);

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

  const toggle = useCallback(() => setOpen((v) => !v), [setOpen]);

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
      <div className="flex h-[72px] shrink-0 items-center justify-between px-5">
        <OriaLogo size="small" />
        <button
          onClick={() => setOpen(false)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone hover:bg-white/60 hover:text-slate-ink transition-colors"
          aria-label="Recolher menu"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
      </div>

      <nav aria-label="Navegação principal" className="min-h-0 space-y-5 overflow-y-auto px-3 pb-3 pt-4">
        {visibleGroups.map((group) => <div key={group.label}><p className="px-3 pb-2 text-[10px] font-semibold uppercase text-stone">{group.label}</p><div className="space-y-0.5">{group.items.map((item) => {
          const isActive = isNavigationActive(pathname, item.href);
          return <Link key={item.href} href={item.href} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-white text-deep-teal shadow-sm ring-1 ring-mist/70" : "text-slate-ink/65 hover:bg-white/60 hover:text-slate-ink"}`}><item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-deep-teal" : "text-stone group-hover:text-slate-ink/75"}`} />{item.label}</Link>;
        })}</div></div>)}
      </nav>

      <div className="flex-1" />

      {/* User section + Logout */}
      <div className="shrink-0 border-t border-mist/60 p-4">
        <Link href="/dashboard/settings" className="block rounded-lg border border-mist bg-white/70 p-3 transition hover:border-deep-teal/40 hover:bg-white">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 shrink-0 text-deep-teal" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-ink" title={session?.principal?.companyName}>{session?.principal?.companyName ?? "Minha empresa"}</p>
              <p className="mt-0.5 text-xs text-stone">{session?.principal?.isAdmin ? "Empresa e usuários" : "Dados da empresa"}</p>
            </div>
            <Settings2 className="h-4 w-4 shrink-0 text-stone" aria-label="Configurações da empresa" />
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-mist pt-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-deep-teal text-xs font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-ink">{session?.user?.name || "Usuário"}</p>
              <p className="truncate text-xs text-stone">{session?.user?.email || ""}</p>
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
        className={`app-mobile-header fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-mist bg-[#F5EFE6] shadow-sm transition-opacity duration-200 ${
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
        <aside className={`app-mobile-drawer fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-[#F5EFE6] shadow-xl transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}>
          {sidebarInner}
        </aside>
      ) : (
        <aside className={`relative z-20 flex h-full shrink-0 flex-col overflow-hidden bg-[#F5EFE6] shadow-[1px_0_0_0_theme(colors.mist)] transition-[width,opacity] duration-300 ease-in-out ${open ? "w-[260px]" : "w-0"}`}>
          <div className="flex h-full w-[260px] flex-col">{sidebarInner}</div>
        </aside>
      )}
    </>
  );
}
