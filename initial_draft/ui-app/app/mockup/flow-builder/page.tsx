const blocks = [
  "Trigger",
  "Mensagem",
  "IA",
  "Condicao",
  "API / Webhook",
  "Delay / Agendamento",
  "Handoff",
  "Atualizar variavel",
  "Encerrar"
];

export default function FlowBuilderPage() {
  return (
    <section className="mockup-page">
      <div className="section-title-row">
        <div>
          <small>Flow Builder (Visual Low-code)</small>
          <h1>Canvas com debug simulado</h1>
        </div>
        <div className="actions">
          <button type="button" className="button secondary">
            Testar
          </button>
          <button type="button" className="button secondary">
            Validar
          </button>
          <button type="button" className="button primary">
            Publicar
          </button>
        </div>
      </div>

      <div className="builder-topline">
        <span>Flow: Agendamento Clinica Prime</span>
        <span>Ambiente: Draft</span>
        <span>Versao: v0.9.3</span>
      </div>

      <div className="builder-layout">
        <article className="card builder-col">
          <h3>Blocos</h3>
          <ul>
            {blocks.map((block) => (
              <li key={block}>{block}</li>
            ))}
          </ul>
        </article>

        <article className="card builder-canvas">
          <h3>Canvas</h3>
          <div className="node-grid">
            <div className="flow-node is-active">Trigger: Mensagem recebida</div>
            <div className="flow-node">Chamar IA: Claude Haiku (temp 0.3)</div>
            <div className="flow-node">Condicao IF: intencao == agendamento</div>
            <div className="flow-node">Integracao: webhook calendario</div>
            <div className="flow-node">Agendamento: 1h antes evento</div>
            <div className="flow-node">Handoff para humano (fallback)</div>
          </div>
          <p className="debug-line">Modo Debug: execucao atual destacada em &quot;Chamar IA&quot;.</p>
        </article>

        <article className="card builder-col">
          <h3>Properties: Chamar IA</h3>
          <ul>
            <li>Modelo: Claude Haiku</li>
            <li>Temperatura: 0.3</li>
            <li>System prompt: tom cordial + foco em agendamento</li>
            <li>Roteador automatico: ativo</li>
          </ul>
          <h4>Condicao IF/ELSE</h4>
          <p>Variavel: intent | Operador: regex | Valor: /(consulta|agendamento)/i</p>
          <h4>Webhook</h4>
          <p>URL: https://api.demo.local/calendar/create</p>
          <p>Headers: Authorization, x-workspace-id</p>
        </article>
      </div>
    </section>
  );
}
