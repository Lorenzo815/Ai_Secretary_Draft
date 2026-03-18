import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="animate-fade-in-up space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-ink">
          Bem-vindo, {session?.user?.name ?? "Usuário"}
        </h1>
        <p className="mt-1 text-sm text-stone">
          Visão geral da sua operação conversacional.
        </p>
      </div>

      {/* Metric cards */}
      <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Conversas hoje"
          value="—"
          icon={<ChatIcon />}
          accent="teal"
          sublabel="Aguardando dados"
        />
        <MetricCard
          label="Custo estimado"
          value="—"
          icon={<CostIcon />}
          accent="jade"
          sublabel="Transparência total"
        />
        <MetricCard
          label="Taxa de resolução"
          value="—"
          icon={<CheckIcon />}
          accent="coral"
          sublabel="IA + humano"
        />
      </div>

      {/* Quick start & Activity */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Quick start */}
        <div className="animate-fade-in-up rounded-2xl border border-mist bg-white p-6">
          <h2 className="font-heading text-base font-semibold text-slate-ink">
            Primeiros passos
          </h2>
          <p className="mt-1 text-sm text-stone">
            Configure sua operação em minutos.
          </p>
          <div className="mt-5 space-y-3">
            <QuickStartItem
              step={1}
              title="Conectar canal WhatsApp"
              description="Integre seu número Business"
              done={false}
            />
            <QuickStartItem
              step={2}
              title="Criar primeiro fluxo"
              description="Use um template ou comece do zero"
              done={false}
            />
            <QuickStartItem
              step={3}
              title="Configurar modelo de IA"
              description="Escolha o LLM ideal para cada caso"
              done={false}
            />
          </div>
        </div>

        {/* Recent activity */}
        <div className="animate-fade-in-up rounded-2xl border border-mist bg-white p-6">
          <h2 className="font-heading text-base font-semibold text-slate-ink">
            Atividade recente
          </h2>
          <p className="mt-1 text-sm text-stone">
            Últimas interações na plataforma.
          </p>
          <div className="mt-5 flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warm-sand">
              <svg className="h-6 w-6 text-stone" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-slate-ink/60">
              Nenhuma atividade ainda
            </p>
            <p className="mt-1 text-xs text-stone">
              Suas conversas e eventos aparecerão aqui.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Metric Card ── */

function MetricCard({
  label,
  value,
  icon,
  accent,
  sublabel,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: "teal" | "jade" | "coral";
  sublabel: string;
}) {
  const accentMap = {
    teal: {
      iconBg: "bg-deep-teal/10",
      iconText: "text-deep-teal",
      valueText: "text-slate-ink",
    },
    jade: {
      iconBg: "bg-soft-jade/20",
      iconText: "text-deep-teal",
      valueText: "text-deep-teal",
    },
    coral: {
      iconBg: "bg-burnt-coral/10",
      iconText: "text-burnt-coral",
      valueText: "text-slate-ink",
    },
  };

  const a = accentMap[accent];

  return (
    <div className="animate-fade-in-up group rounded-2xl border border-mist bg-white p-6 transition-shadow duration-200 hover:shadow-md hover:shadow-slate-ink/[0.04]">
      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <p className="text-sm font-medium text-stone">{label}</p>
          <p className={`text-3xl font-bold tracking-tight ${a.valueText}`}>
            {value}
          </p>
          <p className="text-xs text-stone/70">{sublabel}</p>
        </div>
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${a.iconBg} ${a.iconText}`}
        >
          {icon}
        </span>
      </div>
    </div>
  );
}

/* ── Quick Start Item ── */

function QuickStartItem({
  step,
  title,
  description,
  done,
}: {
  step: number;
  title: string;
  description: string;
  done: boolean;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-mist/60 p-3.5 transition-colors hover:border-mist hover:bg-warm-sand/30">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? "bg-soft-jade/20 text-deep-teal"
            : "bg-deep-teal/10 text-deep-teal"
        }`}
      >
        {done ? "✓" : step}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-ink">{title}</p>
        <p className="mt-0.5 text-xs text-stone">{description}</p>
      </div>
    </div>
  );
}

/* ── Icons ── */

function ChatIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

function CostIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  );
}
