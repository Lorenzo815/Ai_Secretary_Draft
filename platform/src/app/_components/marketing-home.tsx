"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, CalendarCheck2, Check, ChevronRight, CircleDollarSign, Gauge, Handshake, MessageCircleMore, Pause, Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OriaSymbol } from "@/components/oria-logo";
import styles from "./marketing-home.module.css";

const StoryScene = dynamic(() => import("./oria-story-scene"), { ssr: false });
const chapters = ["A conversa", "O contexto", "O harness", "A ação", "Seu controle", "Sua Oria"];
const scenarios = [
  { label: "Agendar", icon: CalendarCheck2, message: "Olá! Quero agendar uma consulta na sexta de manhã.", intent: "Primeira consulta", preference: "Sexta, pela manhã", action: "Consultar horários" },
  { label: "Reagendar", icon: RotateCcw, message: "Minha consulta é amanhã. Posso mudar para sexta?", intent: "Reagendamento", preference: "Preservar o evento atual", action: "Buscar uma nova opção" },
  { label: "Cancelar", icon: Handshake, message: "Preciso cancelar minha consulta. Pode me ajudar?", intent: "Cancelamento", preference: "Decisão da equipe", action: "Encaminhar à equipe" },
];
const layers = [
  { label: "Contexto", title: "Não começa do zero.", text: "Conversa recente, memória, cadastro e estado da agenda compõem o contexto. O relógio e o fuso vêm do servidor.", code: "context.load", owner: "Oria" },
  { label: "Decisão", title: "O modelo propõe. Não autoriza.", text: "O modelo de linguagem escolhe entre responder ou solicitar uma ferramenta. As permissões continuam fora do modelo.", code: "tool_request", owner: "Modelo de IA" },
  { label: "Validação", title: "Antes de agir, precisa passar.", text: "O servidor verifica ferramentas habilitadas, limites e regras. Na agenda, revalida proposta e disponibilidade antes de gravar.", code: "server.validate", owner: "Servidor" },
  { label: "Registro", title: "Uma ação deixa evidência.", text: "Ferramentas, resultados e falhas ficam registrados. A resposta usa o resultado da execução, não uma promessa do modelo.", code: "audit.record", owner: "Oria" },
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
  const finaleBlend = motionEnabled ? Math.max(0, Math.min(1, (progress - 4.05) / 0.45)) : active === 5 ? 1 : 0;

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

  function selectModule(module: "harness" | "whatsapp" | "calendar" | "team" | "pix") {
    if (module === "harness") goToChapter(2);
    else if (module === "whatsapp") goToChapter(1);
    else if (module === "calendar") { selectScenario(0); goToChapter(3); }
    else { setControlView(module === "team" ? "team" : "rules"); goToChapter(4); }
  }

  const scrubStyle = motionEnabled ? {
    opacity: Math.max(0, 1 - Math.max(0, Math.abs(distance) - 0.28) / 0.22),
    transform: `translateY(${-distance * 36}px)`,
  } : undefined;

  return <main className={styles.site} data-motion={motionEnabled ? "on" : "off"}>
    <a href="#story-content" className={styles.skipLink}>Ir para o conteúdo</a>
    <section ref={storyRef} className={styles.story} aria-label="Conheça a Oria">
      <div className={styles.viewport} data-chapter={active} style={{ backgroundColor: `color-mix(in srgb, #eef1ef, #0f766e ${finaleBlend * 100}%)` }}>
        <StoryScene progress={progress} motionEnabled={motionEnabled} scenario={scenarioIndex} layerIndex={layerIndex} calendarEnabled={calendarEnabled} pixEnabled={pixEnabled} onSelect={selectModule} />
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="Oria, início"><OriaSymbol className="h-8 w-8" color="#174d3e" /><span>oria</span></Link>
          <span className={styles.headerDescription}>Inteligência que conduz.</span>
          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} onClick={toggleMotion} aria-pressed={motionEnabled} aria-label={motionEnabled ? "Pausar animações" : "Ativar animações"} title={motionEnabled ? "Pausar animações" : "Ativar animações"}>{motionEnabled ? <Pause /> : <Play />}</button>
            <Link href="/login?callbackUrl=%2Fdashboard" className={styles.login}>Entrar <ArrowRight /></Link>
          </div>
        </header>

        <div className={styles.chapterContent} id="story-content" tabIndex={-1} style={scrubStyle}>
          {active < 5 && <p className={styles.eyebrow}><span className={styles.chapterNumber}>{String(active + 1).padStart(2, "0")}</span>{["OPERAÇÃO CONVERSACIONAL", "TUDO COMEÇA COM UMA MENSAGEM", "AI HARNESS PROPRIETÁRIO", "DA INTENÇÃO AO RESULTADO", "AUTONOMIA COM LIMITES"][active]}</p>}
          {active === 0 && <article>
            <h1 className={styles.heroTitle}>Oria<span>.</span></h1>
            <h2 className={styles.heroStatement}>Cada mensagem pode<br />mover o seu negócio.</h2>
            <p className={styles.body}>A Oria transforma conversas no WhatsApp em próximos passos: entende o cliente, organiza o contexto e conduz cada oportunidade até a ação certa.</p>
            <button className={styles.primaryButton} type="button" onClick={() => goToChapter(1)}>Viver essa jornada <ArrowRight /></button>
            <div className={styles.trust}>
              <span className={styles.metaBrand}><Image src="/meta.svg" alt="" width={58} height={39} /><span>Meta</span></span>
              <strong>Verified<br />Technology Provider</strong>
            </div>
          </article>}
          {active === 1 && <article>
            <h2>Uma mensagem chega.<br /><em>Uma oportunidade começa.</em></h2>
            <p className={styles.body}>Enquanto o cliente conta o que precisa, a Oria reúne histórico, preferências e dados do negócio. Ninguém precisa começar do zero.</p>
            <div className={styles.segmented} role="group" aria-label="Cenário da conversa">{scenarios.map((item, index) => <button type="button" key={item.label} aria-pressed={scenarioIndex === index} onClick={() => selectScenario(index)}><item.icon />{item.label}</button>)}</div>
            <blockquote className={styles.message} key={scenarioIndex}><MessageCircleMore /><span>{scenario.message}<small>Marina · cliente fictícia</small></span></blockquote>
            <button className={styles.textButton} type="button" onClick={() => goToChapter(2)}>Acompanhar a decisão <ArrowRight /></button>
          </article>}
          {active === 2 && <article>
            <h2>A IA entende.<br /><em>A Oria conduz com segurança.</em></h2>
            <p className={styles.body}>Nosso AI Harness transforma intenção em decisão confiável, conectando contexto, modelos e ferramentas sem entregar o controle do seu negócio à IA.</p>
            <div className={styles.layerOptions} role="group" aria-label="Camadas do AI Harness">{layers.map((item, index) => <button type="button" key={item.label} onClick={() => setLayerIndex(index)} aria-pressed={layerIndex === index}><span>0{index + 1}</span>{item.label}<ChevronRight /></button>)}</div>
            <p className={styles.footnote}>Harness desenvolvido pela Oria. Modelos de linguagem de terceiros, com rotas via Vercel ou Azure.</p>
          </article>}
          {active === 3 && <article>
            <h2>{handoff ? <>Quando precisa de alguém,<br /><em>ela sabe chamar.</em></> : <>A conversa avança.<br /><em>O resultado acontece.</em></>}</h2>
            <p className={styles.body}>{handoff ? "Quando a decisão precisa de uma pessoa, a Oria pausa e entrega o contexto completo à equipe. O cliente continua amparado." : "Da intenção ao horário confirmado: a Oria conduz o cliente, valida a disponibilidade e transforma a conversa em uma ação real."}</p>
            <div className={styles.segmented} role="group" aria-label="Testar outro resultado">{scenarios.map((item, index) => <button type="button" key={item.label} aria-pressed={scenarioIndex === index} onClick={() => selectScenario(index)}><item.icon />{item.label}</button>)}</div>
            {!handoff ? <div className={styles.booking}>
              <div className={styles.bookingHeading}><span>Sexta-feira</span><small>Horários ilustrativos</small></div>
              <div className={styles.slots} role="group" aria-label="Horário da simulação">{["09:00", "10:00", "11:30"].map((time) => <button type="button" key={time} aria-pressed={slot === time} onClick={() => { setSlot(time); setConfirmed(false); }}>{time}{slot === time && <Check />}</button>)}</div>
              <button type="button" className={styles.confirmButton} onClick={() => setConfirmed(true)} disabled={confirmed}>{confirmed ? <><Check />{scenarioIndex === 1 ? "Alteração simulada" : "Reserva simulada"}</> : <>{scenarioIndex === 1 ? "Confirmar alteração" : "Confirmar horário"}<ArrowRight /></>}</button>
            </div> : <div className={styles.handoffNote}><Handshake /><div><strong>{!calendarEnabled ? "Ferramenta de agenda desabilitada" : "Cancelamento exige a equipe"}</strong><p>Nenhum evento é excluído por esta simulação.</p></div></div>}
          </article>}
          {active === 4 && <article>
            <h2>Mais autonomia para a operação.<br /><em>Mais controle para você.</em></h2>
            <p className={styles.body}>Escolha o que a Oria pode fazer, acompanhe cada exceção e mantenha sua equipe no comando. Automação que cresce com confiança.</p>
            <div className={styles.segmented} role="group" aria-label="Controles da plataforma">
              <button type="button" aria-pressed={controlView === "rules"} onClick={() => setControlView("rules")}><SlidersHorizontal />Regras</button>
              <button type="button" aria-pressed={controlView === "team"} onClick={() => setControlView("team")}><Handshake />Equipe</button>
              <button type="button" aria-pressed={controlView === "costs"} onClick={() => setControlView("costs")}><Gauge />Consumo</button>
            </div>
            {controlView === "rules" ? <div className={styles.controls}>
              <label><CalendarCheck2 /><span>Agenda<small>Consultar e reservar horários</small></span><input type="checkbox" checked={calendarEnabled} onChange={(event) => { setCalendarEnabled(event.target.checked); setConfirmed(false); }} /></label>
              <label><CircleDollarSign /><span>Pix<small>Pagamento no atendimento</small></span><input type="checkbox" checked={pixEnabled} onChange={(event) => setPixEnabled(event.target.checked)} /></label>
              <button className={styles.textButton} type="button" onClick={() => { selectScenario(0); goToChapter(3); }}>Testar estas regras <ArrowLeft /></button>
            </div> : controlView === "team" ? <div className={styles.controlDetail}><strong>Uma fila. O contexto inteiro.</strong><p>Pedidos humanos e revisões pendentes conectados ao CRM. A pessoa assume sem perder conversa, cadastro ou histórico de ações.</p><span><span className={styles.statusDot} />Aguardando equipe · IA pausada</span></div> : <div className={styles.controlDetail}><strong>Visibilidade, sem custo escondido.</strong><p>Tokens, cache, falhas e estimativas USD/BRL por modelo e provedor. Onde não há tarifa conhecida, o valor é não informado, nunca zero.</p><span><Gauge />24h · 7 dias · 30 dias</span></div>}
          </article>}
          {active === 5 && <article className={styles.finalInvitation}>
            <Image src="/oria-logo.png" alt="Oria" width={512} height={512} unoptimized className={styles.finalLogo} />
            <p className={styles.finalEyebrow}>SUA PRÓXIMA CONVERSA COMEÇA AGORA</p>
            <h2 className={styles.finalTitle}>Pronto para transformar<br />mensagens em movimento?</h2>
            <p className={styles.finalBody}>Entre na Oria e descubra uma operação que entende, conduz e entrega o próximo passo.</p>
            <Link className={styles.primaryButton} href="/login?callbackUrl=%2Fdashboard">Entrar na Oria <ArrowRight /></Link>
            <div className={styles.finalTrust}>
              <span className={styles.metaBrand}><Image src="/meta.svg" alt="" width={58} height={39} /><span>Meta</span></span>
              <strong>Verified<br />Technology Provider</strong>
            </div>
            <Link className={styles.finalPrivacy} href="/privacidade">Política de privacidade <ArrowRight /></Link>
          </article>}
        </div>

        <aside className={styles.sceneCaption} style={scrubStyle} aria-label="Resultado ilustrativo">
          <p className={styles.captionLabel}><span className={styles.statusDot} />{["UMA OPERAÇÃO CONECTADA", "CONTEXTO RECONHECIDO", `${layer.owner.toUpperCase()} / ${layer.code}`, handoff ? "ENCAMINHAMENTO HUMANO" : confirmed ? "RESULTADO DA SIMULAÇÃO" : "AGUARDANDO SUA ESCOLHA", "AGENT STUDIO + OPERAÇÕES", "SUA PRÓXIMA CONVERSA"][active]}</p>
          {active === 0 && <><h3>Uma inteligência. Várias ações.</h3><div className={styles.connectionLabels}><span>WhatsApp</span><ArrowRight /><span>Oria</span><ArrowRight /><span>Agenda · Pix · Equipe</span></div></>}
          {active === 1 && <><h3>{scenario.intent}</h3><p>{scenario.preference}. Conversa vinculada ao cadastro, sem transformar suposições em fatos.</p></>}
          {active === 2 && <><h3>{layer.title}</h3><p>{layer.text}</p></>}
          {active === 3 && <><h3>{handoff ? "A equipe assume. O contexto fica." : confirmed ? `Sexta, ${slot}. ${scenarioIndex === 1 ? "Compromisso atualizado." : "Próximo passo confirmado."}` : scenario.action}</h3><p>{handoff ? "Estado: aguardando atendimento humano. A decisão sobre o compromisso continua com a equipe." : confirmed ? "Exemplo de resultado validado. Esta demonstração não grava nada na agenda." : "A disponibilidade real e as regras são verificadas no servidor antes de executar."}</p></>}
          {active === 4 && <><h3>{controlView === "rules" ? "As permissões não vêm do modelo." : controlView === "team" ? "Autonomia não é abandono." : "Você acompanha o que aconteceu."}</h3><p>{controlView === "rules" ? `Agenda ${calendarEnabled ? "habilitada" : "desabilitada"}. Pix ${pixEnabled ? "habilitado" : "desabilitado"}. A configuração versionada acompanha a execução.` : controlView === "team" ? "Cancelamento, exceções e decisões sensíveis seguem para pessoas. Sem diagnóstico ou aconselhamento médico pela IA." : "Histórico de ferramentas, resultados e métricas. Uma trilha para entender ações e consumo."}</p></>}
          <small className={styles.demoLabel}>Demonstração interativa · dados fictícios</small>
        </aside>

        <nav className={styles.timeline} aria-label="Capítulos da apresentação">
          <button type="button" className={styles.iconButton} disabled={active === 0} onClick={() => goToChapter(active - 1)} aria-label="Capítulo anterior" title="Capítulo anterior"><ArrowLeft /></button>
          <div className={styles.chapterLinks}>{chapters.map((chapter, index) => <button type="button" key={chapter} onClick={() => goToChapter(index)} aria-current={index === active ? "step" : undefined} aria-label={`${index + 1}. ${chapter}`}><span className={styles.chapterTrack}><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress - index + 1))})` }} /></span><span className={styles.chapterLinkLabel}><small>0{index + 1}</small>{chapter}</span></button>)}</div>
          <span className={styles.mobileChapter}>{String(active + 1).padStart(2, "0")} / 06</span>
          <button type="button" className={styles.nextButton} disabled={active === 5} onClick={() => goToChapter(active + 1)} aria-label="Próximo capítulo" title="Próximo capítulo">{active === 0 ? <ArrowDown /> : <ArrowRight />}</button>
        </nav>
        <footer className={styles.footer}><span>© {new Date().getFullYear()} Oria</span><span>Meta Verified Technology Provider</span><Link href="/privacidade">Privacidade <ArrowRight /></Link></footer>
      </div>
    </section>
    <noscript><div className={styles.noScript}><h2>Oria conecta WhatsApp, agenda e equipe.</h2><p>Nosso AI Harness coordena contexto, ferramentas e regras, com validação no servidor e encaminhamento humano.</p><Link href="/login?callbackUrl=%2Fdashboard">Acessar a plataforma</Link><Link href="/privacidade">Política de privacidade</Link></div></noscript>
  </main>;
}