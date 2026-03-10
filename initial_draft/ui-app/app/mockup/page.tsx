import Link from "next/link";

const kpis = [
  { label: "Conversas hoje", value: "1.284" },
  { label: "Taxa de resolucao", value: "78%" },
  { label: "Handoff p/ humano", value: "16%" },
  { label: "CSAT", value: "4.6/5" }
];

const quickActions = [
  { label: "Criar Flow", href: "/mockup/flow-builder" },
  { label: "Ver Inbox", href: "/mockup/inbox" },
  { label: "Conectar Canal", href: "/mockup/canais" },
  { label: "Importar knowledge", href: "/mockup" }
];

export default function MockupDashboardPage() {
  return (
    <section className="mockup-page">
      <div className="section-title-row">
        <div>
          <small>Home / Executive Dashboard</small>
          <h1>Visao executiva da operacao</h1>
        </div>
        <Link className="button secondary" href="/mockup/onboarding">
          Refazer setup inicial
        </Link>
      </div>

      <div className="grid cols-4">
        {kpis.map((metric) => (
          <article key={metric.label} className="card metric-card">
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>

      <div className="grid cols-2">
        <article className="card">
          <h3>Custo do mes</h3>
          <p className="price">R$ 8.430</p>
          <p>Projecao ate o fim do mes: R$ 11.970</p>
          <div className="bar-mock" role="img" aria-label="Projecao de custo">
            <span style={{ width: "68%" }} />
          </div>
        </article>

        <article className="card">
          <h3>Conversas por dia (ultimos 7 dias)</h3>
          <div className="chart-mock" role="img" aria-label="Grafico de conversas por dia">
            <span style={{ height: "24%" }} />
            <span style={{ height: "52%" }} />
            <span style={{ height: "41%" }} />
            <span style={{ height: "63%" }} />
            <span style={{ height: "71%" }} />
            <span style={{ height: "48%" }} />
            <span style={{ height: "66%" }} />
          </div>
          <p>Breakdown canal: WhatsApp 84% | Web 11% | Instagram 5%</p>
        </article>
      </div>

      <div className="grid cols-2">
        <article className="card">
          <h3>Alertas de saude</h3>
          <ul>
            <li>WhatsApp da clinica principal sem webhook confirmado.</li>
            <li>Flow &quot;Suporte Premium&quot; com fallback acima de 12%.</li>
            <li>Router escalou 39 conversas para modelo high-cost hoje.</li>
          </ul>
        </article>

        <article className="card">
          <h3>Acoes rapidas</h3>
          <div className="actions">
            {quickActions.map((action) => (
              <Link key={action.label} className="button secondary" href={action.href}>
                {action.label}
              </Link>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
