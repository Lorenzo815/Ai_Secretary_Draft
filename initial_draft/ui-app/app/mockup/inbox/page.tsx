const conversations = [
  { name: "Mariana Lopes", channel: "WhatsApp", status: "IA em atendimento", unread: 3 },
  { name: "Carlos Nunes", channel: "Web Widget", status: "Humano assumiu", unread: 0 },
  { name: "Rafaela Costa", channel: "WhatsApp", status: "Aguardando cliente", unread: 1 }
];

const thread = [
  "Cliente: Ola, quero remarcar consulta para sexta.",
  "IA: Posso te oferecer 14:00 ou 16:30. Qual horario prefere?",
  "Sistema: Trigger de agenda executado (Google Calendar).",
  "Cliente: 16:30 funciona.",
  "IA: Perfeito, vou confirmar agora e envio o protocolo."
];

export default function InboxPage() {
  return (
    <section className="mockup-page">
      <small>Conversas (Inbox Omnichannel)</small>
      <h1>Operacao em 3 colunas</h1>
      <p>Filtros por canal, estado da conversa, SLA e custo por atendimento.</p>

      <div className="inbox-layout">
        <article className="card inbox-col">
          <h3>Lista de conversas</h3>
          <p>Filtros: canal, status, tags, SLA | Busca ativa: &quot;consulta&quot;</p>
          <ul className="conversation-list">
            {conversations.map((item) => (
              <li key={item.name}>
                <strong>{item.name}</strong>
                <span>{item.channel}</span>
                <span>{item.status}</span>
                <span>Unread: {item.unread}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card inbox-col">
          <h3>Thread</h3>
          <ul className="thread-list">
            {thread.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="state-row">
            <span className="badge ai">IA em atendimento</span>
            <span className="badge human">Humano assumiu</span>
          </div>
          <p>Handoff: motivo &quot;cliente irritado&quot; + checklist de contexto enviado.</p>
        </article>

        <article className="card inbox-col">
          <h3>Painel de contexto</h3>
          <ul>
            <li>Nome: Mariana Lopes</li>
            <li>Telefone: +55 11 99999-1212</li>
            <li>Tags: premium, retorno</li>
            <li>Resumo IA: cliente pediu remarcacao e prefere horario tarde.</li>
            <li>Sentimento: neutro</li>
          </ul>
          <div className="actions">
            <button type="button" className="button secondary">
              Assumir
            </button>
            <button type="button" className="button secondary">
              Transferir
            </button>
            <button type="button" className="button secondary">
              Encerrar
            </button>
            <button type="button" className="button secondary">
              Criar ticket
            </button>
          </div>
          <div className="cost-chip">
            Custo da conversa: 2.340 tokens | R$ 0,87 estimado
          </div>
        </article>
      </div>
    </section>
  );
}
