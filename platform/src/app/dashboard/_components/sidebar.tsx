"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { OriaLogo, OriaSymbol } from "@/components/oria-logo";
import { useEffect, useState, useCallback } from "react";

const navItems = [
  { href: "/dashboard", label: "Home", icon: HomeIcon },
  { href: "/dashboard/canais", label: "Canais", icon: CanaisIcon },
  { href: "/dashboard/fluxos", label: "Fluxos", icon: FluxosIcon },
  { href: "/dashboard/relatorios", label: "Relatórios", icon: RelatoriosIcon },
  { href: "/dashboard/settings", label: "Configurações", icon: SettingsIcon },
];

const LG_BREAKPOINT = 1024;

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
    check();
    // On first mount, open sidebar if desktop
    if (window.innerWidth >= LG_BREAKPOINT) setOpen(true);

    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close drawer on mobile route change
  useEffect(() => {
    if (isMobile) setOpen(false);
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
          <CollapseIcon className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Section label */}
      <div className="px-6 pb-2 pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone">
          Menu
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                isActive
                  ? "bg-white text-deep-teal shadow-sm"
                  : "text-slate-ink/60 hover:bg-white/60 hover:text-slate-ink"
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? "bg-deep-teal/10 text-deep-teal"
                    : "bg-transparent text-stone group-hover:bg-deep-teal/5 group-hover:text-slate-ink/80"
                }`}
              >
                <item.icon className="h-[18px] w-[18px]" />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User section + Logout */}
      <div className="border-t border-mist/60 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/70 p-3">
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
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-stone hover:bg-white/60 hover:text-burnt-coral transition-all duration-150"
        >
          <LogoutIcon className="h-[18px] w-[18px]" />
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
          <HamburgerIcon className="h-5 w-5" />
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

      {/* ── Sidebar panel ── */}
      {isMobile ? (
        /* Mobile: overlay drawer */
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-warm-sand/95 backdrop-blur-md shadow-xl transition-transform duration-300 ease-in-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebarInner}
        </aside>
      ) : (
        /* Desktop: inline collapsible */
        <aside
          className={`shrink-0 flex h-screen flex-col bg-warm-sand/60 shadow-[1px_0_0_0_theme(colors.mist)] transition-[width,opacity] duration-300 ease-in-out overflow-hidden ${
            open ? "w-[260px]" : "w-0"
          }`}
        >
          <div className="flex h-full w-[260px] flex-col">
            {sidebarInner}
          </div>
        </aside>
      )}
    </>
  );
}

/* ---------- Simple SVG Icons ---------- */

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
      />
    </svg>
  );
}

function CanaisIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  );
}

function FluxosIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function RelatoriosIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 19.5L8.25 12l7.5-7.5"
      />
    </svg>
  );
}

function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  );
}
