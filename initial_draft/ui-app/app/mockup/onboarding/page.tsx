const steps = [
  {
    title: "1. Perfil do negocio",
    details: ["Segmento: Saude", "Horario: 07:00-20:00", "Tom: consultivo", "Idioma: pt-BR"]
  },
  {
    title: "2. Objetivo",
    details: ["Atendimento", "Agendamento", "Captura de leads", "Suporte"]
  },
  {
    title: "3. Template",
    details: ["Template selecionado: Clinica Agendamento", "Setup estimado: 6 minutos"]
  },
  {
    title: "4. Conectar canal",
    details: ["WhatsApp Cloud API", "Checklist de webhook", "Teste de entrega"]
  },
  {
    title: "5. Configurar IA",
    details: ["Modelo padrao: Claude Haiku", "Roteamento automatico: ativo"]
  },
  {
    title: "6. Teste e publicar",
    details: ["Chat de teste com 4 cenarios", "Botao publicar fluxo"]
  }
];

export default function OnboardingPage() {
  return (
    <section className="mockup-page">
      <small>Onboarding Wizard</small>
      <h1>Setup em menos de 10 minutos</h1>
      <p>Fluxo guiado para sair do zero ate o canal publicado com template pronto.</p>

      <div className="wizard-grid">
        {steps.map((step) => (
          <article className="card step-card" key={step.title}>
            <h3>{step.title}</h3>
            <ul>
              {step.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <article className="card output-card">
        <h3>Saidas automaticas apos concluir</h3>
        <div className="grid cols-3">
          <p>
            <strong>1 Agent</strong>
            <br />
            Assistente criado e ativo
          </p>
          <p>
            <strong>1 Flow</strong>
            <br />
            Fluxo base clonado do template
          </p>
          <p>
            <strong>1 Canal</strong>
            <br />
            Conectado ou pendente de verificacao
          </p>
        </div>
      </article>
    </section>
  );
}
