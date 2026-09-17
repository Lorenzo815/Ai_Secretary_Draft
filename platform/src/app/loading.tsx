import { OriaLogo } from "@/components/oria-logo";

export default function AppLoading() {
  return (
    <main className="app-canvas flex min-h-dvh items-center justify-center px-6 py-10" aria-busy="true">
      <div className="flex flex-col items-center gap-7" role="status" aria-live="polite">
        <OriaLogo size="large" />
        <div className="flex flex-col items-center gap-3">
          <span className="oria-loading-track" aria-hidden="true">
            <span className="oria-loading-progress" />
          </span>
          <span className="text-sm font-medium text-stone">Carregando a Oria...</span>
        </div>
      </div>
    </main>
  );
}