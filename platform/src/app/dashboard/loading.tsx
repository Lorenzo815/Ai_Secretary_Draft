import { OriaLogo } from "@/components/oria-logo";

export default function DashboardLoading() {
  return (
    <div className="app-canvas flex min-h-dvh" aria-busy="true">
      <aside className="hidden w-64 shrink-0 border-r border-mist bg-soft-ivory/90 px-5 py-5 lg:block">
        <OriaLogo size="small" />
        <div className="mt-12 space-y-8" aria-hidden="true">
          {[3, 2, 2].map((count, group) => (
            <div key={group} className="space-y-3">
              <div className="oria-skeleton h-3 w-20" />
              {Array.from({ length: count }, (_, item) => (
                <div key={item} className="oria-skeleton h-10 w-full" />
              ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <div className="mx-auto max-w-7xl" role="status" aria-live="polite">
          <span className="sr-only">Carregando conteúdo...</span>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-3">
              <div className="oria-skeleton h-7 w-44 sm:w-56" />
              <div className="oria-skeleton h-4 w-64 max-w-[70vw]" />
            </div>
            <div className="oria-skeleton h-10 w-10 sm:w-32" />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 4 }, (_, item) => (
              <div key={item} className="h-28 rounded-lg border border-mist bg-white/70 p-5">
                <div className="oria-skeleton h-3 w-24" />
                <div className="oria-skeleton mt-5 h-7 w-16" />
              </div>
            ))}
          </div>
          <div className="mt-6 overflow-hidden rounded-lg border border-mist bg-white/70 p-5" aria-hidden="true">
            <div className="oria-skeleton h-5 w-40" />
            <div className="mt-6 space-y-4">
              {Array.from({ length: 5 }, (_, item) => (
                <div key={item} className="grid grid-cols-[2fr_1fr] gap-6 border-t border-mist/70 pt-4 sm:grid-cols-[2fr_1fr_1fr]">
                  <div className="oria-skeleton h-4 w-full max-w-xs" />
                  <div className="oria-skeleton h-4 w-20" />
                  <div className="oria-skeleton hidden h-4 w-24 sm:block" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}