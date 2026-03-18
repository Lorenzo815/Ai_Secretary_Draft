export default function CanaisPage() {
  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-ink">
          Canais
        </h1>
        <p className="mt-1 text-sm text-stone">
          Gerencie seus canais de comunicação.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-mist bg-white py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warm-sand">
          <svg className="h-7 w-7 text-stone" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-slate-ink/60">
          Em breve
        </p>
        <p className="mt-1 max-w-xs text-xs text-stone">
          Conecte WhatsApp, Instagram, Webchat e outros canais em um só lugar.
        </p>
      </div>
    </div>
  );
}
