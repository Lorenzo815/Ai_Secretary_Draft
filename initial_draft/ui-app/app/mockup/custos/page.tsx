const costEvents = [
  {
    timestamp: "10:02",
    conversa: "Mariana Lopes",
    modelo: "Claude Haiku",
    tokens: "980 / 420",
    cost: "R$ 0,31"
  },
  {
    timestamp: "10:16",
    conversa: "Carlos Nunes",
    modelo: "GPT-4o",
    tokens: "2100 / 910",
    cost: "R$ 1,45"
  },
  {
    timestamp: "10:28",
    conversa: "Rafaela Costa",
    modelo: "Claude Sonnet",
    tokens: "1540 / 600",
    cost: "R$ 1,08"
  }
];

export default function CustosPage() {
  return (
    <section className="mockup-page">
      <small>Custos (Transparencia total)</small>
      <h1>Painel critico de custos e projecoes</h1>
      <p>Visualizacao por LLM, canal, flow e cliente com alertas de budget.</p>

      <div className="grid cols-4">
        <article className="card metric-card">
          <p>Gasto hoje</p>
          <strong>R$ 421</strong>
        </article>
        <article className="card metric-card">
          <p>Gasto mes</p>
          <strong>R$ 8.430</strong>
        </article>
        <article className="card metric-card">
          <p>Projecao</p>
          <strong>R$ 11.970</strong>
        </article>
        <article className="card metric-card">
          <p>Custo medio / conversa</p>
          <strong>R$ 0,83</strong>
        </article>
      </div>

      <div className="grid cols-2">
        <article className="card">
          <h3>Breakdown por LLM e canal</h3>
          <ul>
            <li>Claude Haiku: 44%</li>
            <li>Claude Sonnet: 21%</li>
            <li>GPT-4o: 19%</li>
            <li>Outros: 16%</li>
          </ul>
          <p>Canal: WhatsApp 82% | Web 12% | Outros 6%</p>
        </article>

        <article className="card">
          <h3>Breakdown por flow e cliente</h3>
          <ul>
            <li>Flow Agendamento: R$ 2.980</li>
            <li>Flow Suporte Premium: R$ 2.240</li>
            <li>Flow Captura Lead: R$ 1.610</li>
          </ul>
          <p>Cliente white-label maior custo: Clinica Prime (R$ 3.1k)</p>
        </article>
      </div>

      <article className="card">
        <h3>Eventos de custo (log)</h3>
        <table className="cost-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Conversa</th>
              <th>Modelo</th>
              <th>Tokens in/out</th>
              <th>R$</th>
            </tr>
          </thead>
          <tbody>
            {costEvents.map((event) => (
              <tr key={`${event.timestamp}-${event.conversa}`}>
                <td>{event.timestamp}</td>
                <td>{event.conversa}</td>
                <td>{event.modelo}</td>
                <td>{event.tokens}</td>
                <td>{event.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="card">
        <h3>Alertas e limites</h3>
        <p>Budget mensal definido: R$ 12.000 (70% consumido)</p>
        <p>Regra ativa: pausar IA premium acima de 95% do budget.</p>
      </article>
    </section>
  );
}
