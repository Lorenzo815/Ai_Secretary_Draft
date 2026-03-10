const channels = [
  { name: "WhatsApp", status: "Desconectado", details: "Numero +55 11 4002-8922 | qualidade media" },
  { name: "Instagram/Messenger", status: "Roadmap", details: "Previsto para Q3" },
  { name: "Web Widget", status: "Conectado", details: "Latencia media 220ms" },
  { name: "Telegram", status: "Opcional", details: "Plugin beta" }
];

export default function CanaisPage() {
  return (
    <section className="mockup-page">
      <small>Canais (WhatsApp-first)</small>
      <h1>Conexao e operacao de canais</h1>
      <p>Cards por canal e detalhe de conexao WhatsApp Cloud API com checklist.</p>

      <div className="grid cols-2">
        {channels.map((channel) => (
          <article key={channel.name} className="card">
            <h3>{channel.name}</h3>
            <p>
              <strong>Status:</strong> {channel.status}
            </p>
            <p>{channel.details}</p>
          </article>
        ))}
      </div>

      <article className="card">
        <h3>WhatsApp Cloud API - Stepper de conexao</h3>
        <ol>
          <li>Token de acesso + Phone Number ID</li>
          <li>Configurar webhook e chave de verificacao</li>
          <li>Confirmar eventos: messages, statuses, template status</li>
          <li>Rodar envio de mensagem de teste</li>
        </ol>
        <div className="actions">
          <button type="button" className="button secondary">
            Testar envio
          </button>
          <button type="button" className="button primary">
            Finalizar conexao
          </button>
        </div>
      </article>

      <article className="card">
        <h3>Templates HSM</h3>
        <p>boas_vindas_clinica: aprovado | lembrete_consulta_24h: pendente</p>
        <p>Controles: janela 24h, fallback para humano, opt-out respeitado.</p>
      </article>
    </section>
  );
}
