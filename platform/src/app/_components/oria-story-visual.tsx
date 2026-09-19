"use client";

import { ArrowRight, CalendarCheck2, Check, CircleDollarSign, Gauge, Handshake, MessageCircleMore, SlidersHorizontal } from "lucide-react";
import { MODEL_PROVIDERS, ModelProviderMark, type ModelProvider } from "./model-provider-marks";
import styles from "./marketing-home.module.css";

type StoryVisualProps = {
  chapter: number;
  scenario: number;
  layerIndex: number;
  calendarEnabled: boolean;
  pixEnabled: boolean;
  confirmed: boolean;
  slot: string;
  handoff: boolean;
};

const requests = [
  ["Agendamento", "Sexta pela manhã"],
  ["Reagendamento", "Manter o horário atual até confirmar"],
  ["Cancelamento", "Encaminhar para uma pessoa"],
];

const safetySteps = [
  ["Entende", "Lê o pedido e o histórico"],
  ["Escolhe", "Sugere o melhor caminho"],
  ["Confere", "Verifica regras e disponibilidade"],
  ["Registra", "Guarda o resultado no histórico"],
];

function ProviderMark(provider: ModelProvider) {
  return (
    <span className={styles.visualProvider}>
      <ModelProviderMark provider={provider} className={provider.icon ? undefined : styles.visualProviderFallback} />
      <strong>{provider.name}</strong>
    </span>
  );
}

export default function OriaStoryVisual({
  chapter,
  scenario,
  layerIndex,
  calendarEnabled,
  pixEnabled,
  confirmed,
  slot,
  handoff,
}: StoryVisualProps) {
  const request = requests[scenario];
  const animationKey = `${chapter}-${scenario}-${layerIndex}-${calendarEnabled}-${pixEnabled}-${confirmed}-${slot}`;

  return (
    <aside className={styles.storyVisual} data-chapter={chapter} aria-label="Demonstração visual de como a Oria trabalha">
      <div className={styles.visualStage} key={animationKey}>
        {chapter === 0 && (
          <div className={`${styles.visualPanel} ${styles.visualFlow}`}>
            <div className={styles.visualFlowHeading}>
              <small>O CAMINHO DE CADA ATENDIMENTO</small>
              <strong>Da mensagem ao próximo passo</strong>
            </div>
            <div className={styles.visualFlowSteps}>
              <div className={styles.visualFlowStep}>
                <span><MessageCircleMore /></span>
                <strong>Cliente pede</strong>
                <small>“Quero agendar”</small>
              </div>
              <span className={styles.visualConnector}><i /><ArrowRight /></span>
              <div className={`${styles.visualFlowStep} ${styles.visualFlowStepCore}`}>
                <span className={styles.visualOriaMark}>o</span>
                <strong>Oria organiza</strong>
                <small>Entende e confere</small>
              </div>
              <span className={styles.visualConnector}><i /><ArrowRight /></span>
              <div className={styles.visualFlowStep}>
                <span><Check /></span>
                <strong>Ação concluída</strong>
                <small>Agenda, Pix ou equipe</small>
              </div>
            </div>
          </div>
        )}

        {chapter === 1 && (
          <div className={`${styles.visualPanel} ${styles.visualConversation}`}>
            <div className={styles.visualWindowHeader}><span /><span /><span /><strong>Nova mensagem no WhatsApp</strong></div>
            <div className={styles.visualMessageBubble}>Olá! Quero agendar uma consulta na sexta de manhã.</div>
            <div className={styles.visualUnderstanding}>
              <p><span className={styles.visualOriaMark}>o</span><strong>A Oria entendeu:</strong></p>
              <div className={styles.visualFacts}>
                <span><small>Pedido</small><strong>{request[0]}</strong></span>
                <span><small>Preferência</small><strong>{request[1]}</strong></span>
                <span><small>Próximo passo</small><strong>{scenario === 2 ? "Chamar a equipe" : "Consultar a agenda"}</strong></span>
              </div>
            </div>
          </div>
        )}

        {chapter === 2 && (
          <div className={`${styles.visualPanel} ${styles.visualModels}`}>
            <div className={styles.visualModelsHeading}>
              <small>ORQUESTRAÇÃO DE MODELOS</small>
              <strong>Cada tarefa segue para o modelo configurado</strong>
            </div>
            <div className={styles.visualProviders}>
              {MODEL_PROVIDERS.map((provider) => <ProviderMark key={provider.name} {...provider} />)}
            </div>
            <div className={styles.visualModelRoute}>
              <span className={styles.visualOriaMark}>o</span>
              <span><strong>Uma única Oria</strong><small>Qualidade, disponibilidade e custo orientam a rota</small></span>
              <ArrowRight />
              <span className={styles.visualModelResult}><Check /><strong>Resposta pronta</strong></span>
            </div>
          </div>
        )}

        {chapter === 3 && (
          <div className={`${styles.visualPanel} ${styles.visualSafety}`}>
            <div className={styles.visualPanelHeading}>
              <span><Check /></span>
              <div><small>Antes de responder</small><strong>A Oria passa por quatro etapas</strong></div>
            </div>
            <div className={styles.visualSafetySteps}>
              {safetySteps.map(([title, description], index) => (
                <div key={title} className={styles.visualSafetyStep} data-active={index === layerIndex}>
                  <span>{index < layerIndex ? <Check /> : index + 1}</span>
                  <div><strong>{title}</strong><small>{description}</small></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {chapter === 4 && (
          <div className={`${styles.visualPanel} ${styles.visualResult}`}>
            {handoff ? (
              <>
                <span className={`${styles.visualResultIcon} ${styles.visualResultHuman}`}><Handshake /></span>
                <small>ATENDIMENTO ENCAMINHADO</small>
                <strong>Sua equipe assume daqui</strong>
                <p>A conversa e o histórico chegam juntos. O cliente não precisa repetir o pedido.</p>
                <span className={styles.visualResultStatus}><i />Aguardando uma pessoa</span>
              </>
            ) : (
              <>
                <span className={styles.visualResultIcon}>{confirmed ? <Check /> : <CalendarCheck2 />}</span>
                <small>{confirmed ? "AÇÃO CONCLUÍDA" : "HORÁRIO ENCONTRADO"}</small>
                <strong>{confirmed ? `Sexta-feira, ${slot}` : "Sexta-feira disponível"}</strong>
                <p>{confirmed ? "O cliente recebe a confirmação na conversa." : "A Oria confere a disponibilidade antes de confirmar."}</p>
                <span className={styles.visualResultStatus}><i />{confirmed ? "Agendamento confirmado" : "Pronto para confirmar"}</span>
              </>
            )}
          </div>
        )}

        {chapter === 5 && (
          <div className={`${styles.visualPanel} ${styles.visualControl}`}>
            <div className={styles.visualPanelHeading}>
              <span><SlidersHorizontal /></span>
              <div><small>VOCÊ DEFINE AS REGRAS</small><strong>Painel de controle da Oria</strong></div>
            </div>
            <div className={styles.visualPermissions}>
              <div><CalendarCheck2 /><span><strong>Agenda</strong><small>Consultar e reservar</small></span><i data-enabled={calendarEnabled} /></div>
              <div><CircleDollarSign /><span><strong>Pix</strong><small>Criar pagamentos</small></span><i data-enabled={pixEnabled} /></div>
            </div>
            <div className={styles.visualControlSummary}>
              <span><Handshake /><strong>Equipe</strong><small>Recebe as exceções</small></span>
              <span><Gauge /><strong>Uso</strong><small>Ações e custos visíveis</small></span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
