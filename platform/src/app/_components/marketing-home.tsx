"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, CalendarCheck2, Check, ChevronRight, CircleDollarSign, Gauge, Handshake, MessageCircleMore, Pause, Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OriaSymbol } from "@/components/oria-logo";
import styles from "./marketing-home.module.css";
import { ModelProviderMark, TRUSTED_MODEL_PROVIDERS } from "./model-provider-marks";
import OriaStoryVisual from "./oria-story-visual";

const chapters = ["A conversa", "O entendimento", "Os modelos", "A segurança", "A ação", "Seu controle", "Começar"];
const chapterEyebrows = [
  "DO WHATSAPP AO PRÓXIMO PASSO",
  "A ORIA ENTENDE O PEDIDO",
  "UM MODELO DE IA PARA CADA TAREFA",
  "A ORIA CONFERE ANTES DE AGIR",
  "A ORIA REALIZA OU CHAMA SUA EQUIPE",
  "VOCÊ DEFINE OS LIMITES",
];
const scenarios = [
  { label: "Agendar", icon: CalendarCheck2, message: "Olá! Quero agendar uma consulta na sexta de manhã.", intent: "Primeira consulta", preference: "Sexta, pela manhã", action: "Consultar horários" },
  { label: "Reagendar", icon: RotateCcw, message: "Minha consulta é amanhã. Posso mudar para sexta?", intent: "Reagendamento", preference: "Preservar o evento atual", action: "Buscar uma nova opção" },
  { label: "Cancelar", icon: Handshake, message: "Preciso cancelar minha consulta. Pode me ajudar?", intent: "Cancelamento", preference: "Decisão da equipe", action: "Encaminhar à equipe" },
];
const layers = [
  { label: "Entende", title: "Primeiro, entende o pedido.", text: "A Oria lê a conversa, reconhece o cliente e reúne as informações necessárias para não começar do zero.", step: "PASSO 1 · ENTENDER" },
  { label: "Escolhe", title: "Depois, sugere o próximo passo.", text: "A inteligência artificial identifica a melhor resposta ou ação, mas não recebe liberdade para fazer qualquer coisa.", step: "PASSO 2 · ESCOLHER" },
  { label: "Confere", title: "Antes de agir, confere suas regras.", text: "A Oria verifica permissões, limites e disponibilidade. Só depois dessa checagem a ação pode acontecer.", step: "PASSO 3 · CONFERIR" },
  { label: "Registra", title: "Por fim, registra o resultado.", text: "Cada ação, resultado ou falha fica no histórico para sua equipe acompanhar o que realmente aconteceu.", step: "PASSO 4 · REGISTRAR" },
];

function subscribeMotion(onChange: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => { preference.removeEventListener("change", onChange); window.removeEventListener("storage", onChange); };
}

function readMotion() {
  try {
    const saved = localStorage.getItem("oria-site-motion");
    if (saved === "on" || saved === "off") return saved === "on";
  } catch {}
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function serverMotion() { return false; }

function TechnologyTrust({ className }: { className: string }) {
  return (
    <div className={className}>
      <span className={styles.metaBrand}><Image src="/meta.svg" alt="" width={58} height={39} /><span>Meta</span></span>
      <strong>Verified<br />Technology Provider</strong>
      <span className={styles.modelTrust} aria-label="Compatível com modelos de Google, OpenAI, Anthropic, NVIDIA, DeepSeek e mais de 100 opções">
        {TRUSTED_MODEL_PROVIDERS.map((provider) => (
          <span key={provider.name}>
            <ModelProviderMark provider={provider} className={provider.icon ? undefined : styles.modelTrustFallback} />
            <small>{provider.name}</small>
          </span>
        ))}
        <span className={styles.modelTrustCount}><strong>100+</strong><small>modelos</small></span>
      </span>
    </div>
  );
}

export default function MarketingHome() {
  const storyRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [layerIndex, setLayerIndex] = useState(2);
  const [slot, setSlot] = useState("10:00");
  const [confirmed, setConfirmed] = useState(false);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [pixEnabled, setPixEnabled] = useState(true);
  const [controlView, setControlView] = useState("rules");
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const preferredMotion = useSyncExternalStore(subscribeMotion, readMotion, serverMotion);
  const motionEnabled = motionOverride ?? preferredMotion;
  const active = Math.min(chapters.length - 1, Math.round(progress));
  const scenario = scenarios[scenarioIndex];
  const handoff = scenarioIndex === 2 || !calendarEnabled;
  const layer = layers[layerIndex];
  const distance = progress - active;
  const finaleBlend = motionEnabled ? Math.max(0, Math.min(1, (progress - 5.05) / 0.45)) : active === 6 ? 1 : 0;

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const story = storyRef.current;
      if (!story) return;
      const top = story.getBoundingClientRect().top;
      const range = story.offsetHeight - window.innerHeight;
      setProgress(Math.max(0, Math.min(chapters.length - 1, -top / Math.max(range, 1) * (chapters.length - 1))));
    };
    const requestMeasure = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(requestMeasure);
    if (storyRef.current) observer.observe(storyRef.current);
    window.addEventListener("scroll", requestMeasure, { passive: true });
    window.addEventListener("resize", requestMeasure);
    requestMeasure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", requestMeasure); window.removeEventListener("resize", requestMeasure); };
  }, []);

  function goToChapter(index: number) {
    const story = storyRef.current;
    if (!story) return;
    const top = window.scrollY + story.getBoundingClientRect().top;
    const range = story.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + index / (chapters.length - 1) * range, behavior: motionEnabled ? "smooth" : "instant" });
  }

  function toggleMotion() {
    setMotionOverride(!motionEnabled);
    try { localStorage.setItem("oria-site-motion", motionEnabled ? "off" : "on"); } catch {}
  }

  function selectScenario(index: number) {
    setScenarioIndex(index);
    setConfirmed(false);
  }

  const scrubStyle = motionEnabled ? {
    opacity: Math.max(0, 1 - Math.max(0, Math.abs(distance) - 0.28) / 0.22),
    transform: `translateY(${-distance * 36}px)`,
  } : undefined;

  return <main className={styles.site} data-motion={motionEnabled ? "on" : "off"}>
    <a href="#story-content" className={styles.skipLink}>Ir para o conteúdo</a>
    <section className={styles.intro} aria-label="Apresentação da Oria">
      <div className={styles.introGlow} aria-hidden="true" />
      <div className={styles.introContent}>
        <div className={styles.introBrand} aria-label="Oria">
          <OriaSymbol className={styles.introSymbol} color="#174d3e" />
          <span>oria</span>
        </div>
        <p className={styles.introTagline}>Inteligência que transforma conversas em ação.</p>
        <TechnologyTrust className={styles.introTrust} />
        <p className={styles.providerNote}>Modelos disponíveis conforme região e configuração.</p>
      </div>
      <button type="button" className={styles.introScroll} onClick={() => storyRef.current?.scrollIntoView({ behavior: motionEnabled ? "smooth" : "auto" })}>
        <span>Role para conhecer a Oria</span>
        <ArrowDown />
      </button>
    </section>
    <section id="oria-story" ref={storyRef} className={styles.story} aria-label="Conheça a Oria">
      <div className={styles.viewport} data-chapter={active} style={{ backgroundColor: `color-mix(in srgb, #eef1ef, #0f766e ${finaleBlend * 100}%)` }}>
        {active < 6 && <OriaStoryVisual chapter={active} scenario={scenarioIndex} layerIndex={layerIndex} calendarEnabled={calendarEnabled} pixEnabled={pixEnabled} confirmed={confirmed} slot={slot} handoff={handoff} />}
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="Oria, início"><OriaSymbol className="h-8 w-8" color="#174d3e" /><span>oria</span></Link>
          <span className={styles.headerDescription}>Do WhatsApp à ação.</span>
          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} onClick={toggleMotion} aria-pressed={motionEnabled} aria-label={motionEnabled ? "Pausar animações" : "Ativar animações"} title={motionEnabled ? "Pausar animações" : "Ativar animações"}>{motionEnabled ? <Pause /> : <Play />}</button>
            <Link href="/login?callbackUrl=%2Fdashboard" className={styles.login}>Entrar <ArrowRight /></Link>
          </div>
        </header>

        <div className={styles.chapterContent} id="story-content" tabIndex={-1} style={scrubStyle}>
          {active < 6 && <p className={styles.eyebrow}><span className={styles.chapterNumber}>{String(active + 1).padStart(2, "0")}</span>{chapterEyebrows[active]}</p>}
          {active === 0 && <article>
            <h1 className={styles.heroTitle}>Oria<span>.</span></h1>
            <h2 className={styles.heroStatement}>Cada mensagem pode<br />mover o seu negócio.</h2>
            <p className={styles.body}>A Oria transforma conversas no WhatsApp em próximos passos: entende o cliente, organiza o contexto e conduz cada oportunidade até a ação certa.</p>
            <button className={styles.primaryButton} type="button" onClick={() => goToChapter(1)}>Ver como funciona <ArrowRight /></button>
          </article>}
          {active === 1 && <article>
            <h2>Uma mensagem chega.<br /><em>Uma oportunidade começa.</em></h2>
            <p className={styles.body}>A Oria identifica quem está falando, entende o pedido e reúne o histórico do cliente. Sua equipe não precisa procurar informações em várias telas.</p>
            <div className={styles.segmented} role="group" aria-label="Cenário da conversa">{scenarios.map((item, index) => <button type="button" key={item.label} aria-pressed={scenarioIndex === index} onClick={() => selectScenario(index)}><item.icon />{item.label}</button>)}</div>
            <blockquote className={styles.message} key={scenarioIndex}><MessageCircleMore /><span>{scenario.message}<small>Marina · cliente fictícia</small></span></blockquote>
            <button className={`${styles.textButton} ${styles.storyNextLink}`} type="button" onClick={() => goToChapter(2)}>Entender o próximo passo <ArrowRight /></button>
          </article>}
          {active === 2 && <article>
            <h2>Vários modelos de IA.<br /><em>Uma escolha para cada tarefa.</em></h2>
            <p className={styles.body}>Por trás de uma resposta simples, a Oria organiza as opções disponíveis e direciona cada trabalho para o modelo configurado. Você ganha flexibilidade e controle sem gerenciar essa complexidade.</p>
            <ul className={styles.orchestrationPoints}>
              <li><Check /><span><strong>Configuração por tarefa</strong><small>Atendimento e análise podem usar modelos diferentes</small></span></li>
              <li><Check /><span><strong>Continuidade</strong><small>Rotas alternativas podem ser configuradas</small></span></li>
              <li><Check /><span><strong>Visibilidade</strong><small>Uso, resultado e custo ficam registrados</small></span></li>
            </ul>
            <p className={styles.footnote}>A disponibilidade depende do modelo, da região e da configuração contratada.</p>
          </article>}
          {active === 3 && <article>
            <h2>Ela entende o pedido.<br /><em>E confere antes de agir.</em></h2>
            <p className={styles.body}>Pense na Oria como uma atendente cuidadosa: ela entende, escolhe um caminho, verifica as regras do seu negócio e registra o resultado.</p>
            <div className={styles.layerOptions} role="group" aria-label="Etapas de segurança da Oria">{layers.map((item, index) => <button type="button" key={item.label} onClick={() => setLayerIndex(index)} aria-pressed={layerIndex === index}><span>0{index + 1}</span>{item.label}<ChevronRight /></button>)}</div>
            <p className={styles.footnote}>Em resumo: a IA ajuda a escolher. As regras do seu negócio autorizam. A Oria registra.</p>
          </article>}
          {active === 4 && <article>
            <h2>{handoff ? <>Quando precisa de alguém,<br /><em>ela sabe chamar.</em></> : <>A conversa avança.<br /><em>O resultado acontece.</em></>}</h2>
            <p className={styles.body}>{handoff ? "Quando a decisão precisa de uma pessoa, a Oria pausa e entrega a conversa completa à equipe. O cliente não precisa repetir tudo." : "A Oria consulta os horários, confirma a escolha e responde ao cliente. A conversa vira uma tarefa concluída, sem troca manual de telas."}</p>
            <div className={styles.segmented} role="group" aria-label="Testar outro resultado">{scenarios.map((item, index) => <button type="button" key={item.label} aria-pressed={scenarioIndex === index} onClick={() => selectScenario(index)}><item.icon />{item.label}</button>)}</div>
            {!handoff ? <div className={styles.booking}>
              <div className={styles.bookingHeading}><span>Sexta-feira</span><small>Horários ilustrativos</small></div>
              <div className={styles.slots} role="group" aria-label="Horário da simulação">{["09:00", "10:00", "11:30"].map((time) => <button type="button" key={time} aria-pressed={slot === time} onClick={() => { setSlot(time); setConfirmed(false); }}>{time}{slot === time && <Check />}</button>)}</div>
              <button type="button" className={styles.confirmButton} onClick={() => setConfirmed(true)} disabled={confirmed}>{confirmed ? <><Check />{scenarioIndex === 1 ? "Alteração simulada" : "Reserva simulada"}</> : <>{scenarioIndex === 1 ? "Confirmar alteração" : "Confirmar horário"}<ArrowRight /></>}</button>
            </div> : <div className={styles.handoffNote}><Handshake /><div><strong>{!calendarEnabled ? "Ferramenta de agenda desabilitada" : "Cancelamento exige a equipe"}</strong><p>Nenhum evento é excluído por esta simulação.</p></div></div>}
          </article>}
          {active === 5 && <article>
            <h2>A Oria trabalha.<br /><em>Você define até onde.</em></h2>
            <p className={styles.body}>Escolha quais ações podem ser automáticas, quais precisam da equipe e acompanhe tudo em um só lugar.</p>
            <div className={styles.segmented} role="group" aria-label="Controles da plataforma">
              <button type="button" aria-pressed={controlView === "rules"} onClick={() => setControlView("rules")}><SlidersHorizontal />Regras</button>
              <button type="button" aria-pressed={controlView === "team"} onClick={() => setControlView("team")}><Handshake />Equipe</button>
              <button type="button" aria-pressed={controlView === "costs"} onClick={() => setControlView("costs")}><Gauge />Consumo</button>
            </div>
            {controlView === "rules" ? <div className={styles.controls}>
              <label><CalendarCheck2 /><span>Agenda<small>Consultar e reservar horários</small></span><input type="checkbox" checked={calendarEnabled} onChange={(event) => { setCalendarEnabled(event.target.checked); setConfirmed(false); }} /></label>
              <label><CircleDollarSign /><span>Pix<small>Pagamento no atendimento</small></span><input type="checkbox" checked={pixEnabled} onChange={(event) => setPixEnabled(event.target.checked)} /></label>
              <button className={styles.textButton} type="button" onClick={() => { selectScenario(0); goToChapter(4); }}>Testar estas regras <ArrowLeft /></button>
            </div> : controlView === "team" ? <div className={styles.controlDetail}><strong>Sua equipe recebe tudo pronto.</strong><p>Quando uma pessoa precisa assumir, ela recebe a conversa, o cadastro e o histórico das ações. O cliente não volta ao início.</p><span><span className={styles.statusDot} />Aguardando equipe · automação pausada</span></div> : <div className={styles.controlDetail}><strong>Você sabe quanto está usando.</strong><p>Acompanhe o uso da inteligência artificial, os custos estimados e eventuais falhas por período.</p><span><Gauge />24h · 7 dias · 30 dias</span></div>}
          </article>}
          {active === 6 && <article className={styles.finalInvitation}>
            <Image src="/oria-logo.png" alt="Oria" width={512} height={512} unoptimized className={styles.finalLogo} />
            <p className={styles.finalEyebrow}>O PRÓXIMO PASSO É SEU</p>
            <h2 className={styles.finalTitle}>Sua empresa está pronta<br />para transformar mensagens em resultados?</h2>
            <p className={styles.finalBody}>Comece agora e veja como a Oria pode organizar o atendimento, realizar tarefas e ajudar mais clientes a avançar.</p>
            <ul className={styles.finalBenefits}>
              <li><Check />Respostas mais rápidas</li>
              <li><Check />Agenda organizada</li>
              <li><Check />Equipe no controle</li>
            </ul>
            <Link className={`${styles.primaryButton} ${styles.finalCta}`} href="/login?callbackUrl=%2Fdashboard">Começar agora <ArrowRight /></Link>
            <p className={styles.finalCtaHint}>Clique para entrar e conhecer a plataforma.</p>
            <TechnologyTrust className={styles.finalTrust} />
            <Link className={styles.finalPrivacy} href="/privacidade">Política de privacidade <ArrowRight /></Link>
          </article>}
        </div>

        <aside className={styles.sceneCaption} style={scrubStyle} aria-label="Resultado ilustrativo">
          <p className={styles.captionLabel}><span className={styles.statusDot} />{["VEJA O FLUXO", "PEDIDO ENTENDIDO", "ORQUESTRAÇÃO DE MODELOS", layer.step, handoff ? "SUA EQUIPE ENTRA NA CONVERSA" : confirmed ? "TAREFA CONCLUÍDA" : "ESCOLHA O RESULTADO", "VOCÊ CONTINUA NO CONTROLE", "COMECE AGORA"][active]}</p>
          {active === 0 && <><h3>A Oria fica no centro da operação.</h3><div className={styles.connectionLabels}><span>Mensagem do cliente</span><ArrowRight /><span>Oria entende e confere</span><ArrowRight /><span>Ação concluída</span></div></>}
          {active === 1 && <><h3>{scenario.intent}</h3><p>{scenario.preference}. A Oria liga o pedido ao cadastro e ao histórico do cliente antes de responder.</p></>}
          {active === 2 && <><h3>A complexidade fica nos bastidores.</h3><p>A Oria pode direcionar tarefas entre diferentes famílias de modelos conforme qualidade, disponibilidade e configuração.</p></>}
          {active === 3 && <><h3>{layer.title}</h3><p>{layer.text}</p></>}
          {active === 4 && <><h3>{handoff ? "A equipe assume. O contexto fica." : confirmed ? `Sexta, ${slot}. ${scenarioIndex === 1 ? "Compromisso atualizado." : "Próximo passo confirmado."}` : scenario.action}</h3><p>{handoff ? "Estado: aguardando atendimento humano. A decisão sobre o compromisso continua com a equipe." : confirmed ? "Exemplo de resultado validado. Esta demonstração não grava nada na agenda." : "A disponibilidade real e as regras são verificadas no servidor antes de executar."}</p></>}
          {active === 5 && <><h3>{controlView === "rules" ? "A Oria só faz o que você permitir." : controlView === "team" ? "Quando precisa, uma pessoa assume." : "Uso e custos ficam visíveis."}</h3><p>{controlView === "rules" ? `Agenda ${calendarEnabled ? "habilitada" : "desabilitada"}. Pix ${pixEnabled ? "habilitado" : "desabilitado"}. As regras são conferidas antes de cada ação.` : controlView === "team" ? "Cancelamentos, exceções e decisões sensíveis seguem para sua equipe com todo o contexto." : "Consulte ações, resultados, falhas e estimativas de custo sem precisar decifrar relatórios técnicos."}</p></>}
          <small className={styles.demoLabel}>Demonstração interativa · dados fictícios</small>
        </aside>

        <nav className={styles.timeline} aria-label="Capítulos da apresentação">
          <button type="button" className={styles.iconButton} disabled={active === 0} onClick={() => goToChapter(active - 1)} aria-label="Capítulo anterior" title="Capítulo anterior"><ArrowLeft /></button>
          <div className={styles.chapterLinks}>{chapters.map((chapter, index) => <button type="button" key={chapter} onClick={() => goToChapter(index)} aria-current={index === active ? "step" : undefined} aria-label={`${index + 1}. ${chapter}`}><span className={styles.chapterTrack}><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress - index + 1))})` }} /></span><span className={styles.chapterLinkLabel}><small>0{index + 1}</small>{chapter}</span></button>)}</div>
          <span className={styles.mobileChapter}>{String(active + 1).padStart(2, "0")} / 07</span>
          <button type="button" className={styles.nextButton} disabled={active === 6} onClick={() => goToChapter(active + 1)} aria-label="Próximo capítulo" title="Próximo capítulo">{active === 0 ? <ArrowDown /> : <ArrowRight />}</button>
        </nav>
        <footer className={styles.footer}><span>© {new Date().getFullYear()} Oria</span><span>Meta Verified Technology Provider</span><Link href="/privacidade">Privacidade <ArrowRight /></Link></footer>
      </div>
    </section>
    <noscript><div className={styles.noScript}><h2>Oria conecta WhatsApp, agenda e equipe.</h2><p>Ela entende o pedido, confere as regras do seu negócio e realiza o próximo passo com segurança.</p><Link href="/login?callbackUrl=%2Fdashboard">Acessar a plataforma</Link><Link href="/privacidade">Política de privacidade</Link></div></noscript>
  </main>;
}