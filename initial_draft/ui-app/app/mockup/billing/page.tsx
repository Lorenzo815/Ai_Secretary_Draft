export default function BillingPage() {
  return (
    <section className="mockup-page">
      <small>Billing / Plano</small>
      <h1>Assinatura, overages e faturas</h1>
      <p>Resumo do plano atual e previsao financeira da proxima fatura.</p>

      <div className="grid cols-2">
        <article className="card">
          <h3>Plano atual</h3>
          <p>
            <strong>Growth</strong> - R$ 499/mes
          </p>
          <ul>
            <li>Uso de tokens: 71%</li>
            <li>Mensagens WhatsApp: 2.140 / 2.500</li>
            <li>Add-on premium model: ativo</li>
          </ul>
        </article>

        <article className="card">
          <h3>Proxima fatura (estimada)</h3>
          <p className="price">R$ 1.184</p>
          <ul>
            <li>Assinatura base: R$ 499</li>
            <li>Overage tokens: R$ 515</li>
            <li>Mensagens extras WhatsApp: R$ 170</li>
          </ul>
        </article>
      </div>

      <div className="grid cols-2">
        <article className="card">
          <h3>Metodo de pagamento</h3>
          <p>Stripe - cartao final 0243</p>
          <button type="button" className="button secondary">
            Atualizar metodo
          </button>
        </article>

        <article className="card">
          <h3>Historico de faturas</h3>
          <ul>
            <li>Jan/2026 - R$ 932 - pago</li>
            <li>Fev/2026 - R$ 1.041 - pago</li>
            <li>Mar/2026 - em aberto (estimado)</li>
          </ul>
          <button type="button" className="button secondary">
            Baixar PDF
          </button>
        </article>
      </div>

      <article className="card">
        <h3>Gerenciar plano</h3>
        <p>Upgrade para Pro ou downgrade controlado para Starter.</p>
        <div className="actions">
          <button type="button" className="button primary">
            Upgrade para Pro
          </button>
          <button type="button" className="button secondary">
            Solicitar downgrade
          </button>
        </div>
      </article>
    </section>
  );
}
