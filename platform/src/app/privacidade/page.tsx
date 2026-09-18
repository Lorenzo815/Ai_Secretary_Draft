import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OriaSymbol } from "@/components/oria-logo";
import styles from "../_components/legal.module.css";

export const metadata: Metadata = {
  title: "Política de Privacidade | Oria",
  description: "Como a Oria coleta, usa, compartilha e protege dados pessoais no atendimento conversacional com IA.",
};

const UPDATED_AT = "18 de setembro de 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className={styles.legal}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}><ArrowLeft aria-hidden="true" /> Voltar ao site</Link>
        <Link href="/" aria-label="Oria, início" className={styles.brand}><OriaSymbol className="h-7 w-7" color="#FCFAF6" /><span>Oria</span></Link>
      </header>

      <article className={styles.document}>
        <p className={styles.eyebrow}>Documento legal</p>
        <h1>Política de Privacidade</h1>
        <p className={styles.updated}>Última atualização: {UPDATED_AT}</p>

        <div className={styles.callout} role="note">
          <strong>Modelo de referência.</strong> Este texto descreve o funcionamento técnico da plataforma Oria e serve como base.
          Antes da publicação, revise com assessoria jurídica e preencha os campos entre colchetes com os dados do controlador.
        </div>

        <nav className={styles.toc} aria-label="Sumário">
          <a href="#papeis">1. Controlador e operador</a>
          <a href="#dados">2. Dados que tratamos</a>
          <a href="#uso">3. Finalidades</a>
          <a href="#ia">4. Inteligência artificial</a>
          <a href="#compartilhamento">5. Compartilhamento</a>
          <a href="#retencao">6. Retenção</a>
          <a href="#seguranca">7. Segurança</a>
          <a href="#direitos">8. Direitos do titular</a>
          <a href="#contato">9. Contato</a>
        </nav>

        <section id="papeis">
          <h2>1. Controlador e operador de dados</h2>
          <p>
            A Oria é uma plataforma de atendimento administrativo conversacional utilizada por clínicas e prestadores de serviço.
            Em regra, a clínica contratante é a <strong>controladora</strong> dos dados pessoais de seus pacientes e define as
            finalidades do tratamento. A Oria atua como <strong>operadora</strong>, processando dados conforme as instruções da
            clínica e este documento.
          </p>
          <p>Controlador: <strong>[Razão social]</strong>, CNPJ <strong>[00.000.000/0000-00]</strong>, <strong>[endereço]</strong>.</p>
          <p>Encarregado (DPO): <strong>[nome e e-mail do encarregado]</strong>.</p>
        </section>

        <section id="dados">
          <h2>2. Dados que tratamos</h2>
          <p>De acordo com a configuração da clínica, a plataforma pode tratar:</p>
          <ul>
            <li><strong>Identificação e contato:</strong> nome, número de telefone do WhatsApp e identificadores de conversa.</li>
            <li><strong>Conteúdo da conversa:</strong> mensagens de texto, mídias enviadas (como imagens) e histórico do atendimento.</li>
            <li><strong>Dados cadastrais:</strong> data de nascimento, profissão e endereço, quando solicitados pela clínica.</li>
            <li><strong>CPF:</strong> quando configurado como campo de cadastro, é validado e armazenado de forma cifrada.</li>
            <li><strong>Agenda:</strong> agendamentos, confirmações, reagendamentos e eventos relacionados.</li>
            <li><strong>Pagamentos:</strong> solicitações e status de pagamento (por exemplo, Pix). A Oria não armazena dados de cartão.</li>
            <li><strong>Análises comerciais:</strong> qualificação de leads, sinais de interesse e estimativas de contexto para revisão humana.</li>
            <li><strong>Dados operacionais:</strong> registros técnicos de execução, entregas de mensagens e uso de modelos de IA.</li>
          </ul>
          <p>
            A Oria orienta que a clínica configure o atendimento para <strong>não solicitar dados de saúde sensíveis</strong> pelo canal.
            O agente é instruído a tratar apenas assuntos administrativos e a não realizar diagnóstico, triagem clínica ou aconselhamento médico.
          </p>
        </section>

        <section id="uso">
          <h2>3. Finalidades do tratamento</h2>
          <ul>
            <li>Prestar atendimento e responder solicitações pelo WhatsApp.</li>
            <li>Realizar e confirmar agendamentos e acompanhamentos.</li>
            <li>Processar solicitações de pagamento e sua confirmação.</li>
            <li>Organizar o relacionamento comercial e apoiar decisões humanas da equipe.</li>
            <li>Operar, auditar, proteger e melhorar a plataforma.</li>
            <li>Cumprir obrigações legais e regulatórias aplicáveis.</li>
          </ul>
        </section>

        <section id="ia">
          <h2>4. Uso de inteligência artificial</h2>
          <p>
            O atendimento é conduzido pelo <strong>AI Harness</strong> proprietário da Oria, que coordena modelos de linguagem,
            ferramentas de negócio e regras operacionais. Para gerar respostas e análises, trechos recentes da conversa — incluindo
            texto e, quando relevante, imagens enviadas pelo paciente — podem ser transmitidos a provedores de modelos de IA
            contratados (por exemplo, provedores acessados via <strong>Vercel AI Gateway</strong> e <strong>Azure OpenAI</strong>).
          </p>
          <ul>
            <li>Decisões sensíveis (autorização, confirmação e mutações) são validadas no servidor, não pelo modelo.</li>
            <li>Estimativas geradas por IA são apoio para <strong>revisão humana</strong> e não constituem decisão automatizada definitiva.</li>
            <li>O tratamento por cada provedor segue os termos e as políticas de privacidade do respectivo provedor.</li>
          </ul>
        </section>

        <section id="compartilhamento">
          <h2>5. Compartilhamento com terceiros</h2>
          <p>Os dados podem ser compartilhados com operadores estritamente necessários à prestação do serviço:</p>
          <ul>
            <li><strong>Meta / WhatsApp:</strong> para envio e recebimento de mensagens no canal.</li>
            <li><strong>Provedores de modelos de IA:</strong> para processamento das mensagens e geração de respostas.</li>
            <li><strong>Provedores de pagamento:</strong> para processar cobranças e confirmar pagamentos.</li>
            <li><strong>Infraestrutura de nuvem e banco de dados:</strong> para hospedagem e operação da plataforma.</li>
          </ul>
          <p>A Oria não vende dados pessoais. Transferências internacionais, quando ocorrerem, seguem as salvaguardas legais aplicáveis.</p>
        </section>

        <section id="retencao">
          <h2>6. Retenção e eliminação</h2>
          <p>
            Os dados são mantidos pelo tempo necessário às finalidades acima ou conforme exigido por lei. Registros técnicos de
            chamadas de IA têm retenção reduzida e são expirados automaticamente após <strong>30 dias</strong>. Mediante solicitação
            do titular à clínica controladora, os dados do atendimento podem ser eliminados da plataforma, ressalvadas obrigações
            legais de guarda.
          </p>
        </section>

        <section id="seguranca">
          <h2>7. Segurança da informação</h2>
          <ul>
            <li>O CPF é cifrado e protegido; não é exposto na memória do agente.</li>
            <li>Segredos de pagamento e credenciais permanecem no servidor e não são enviados ao navegador.</li>
            <li>O acesso à plataforma exige autenticação; senhas são armazenadas com hash.</li>
            <li>Medidas técnicas e organizacionais protegem os dados contra acesso não autorizado.</li>
          </ul>
        </section>

        <section id="direitos">
          <h2>8. Direitos do titular</h2>
          <p>
            Nos termos da <strong>LGPD (Lei nº 13.709/2018)</strong>, o titular pode solicitar confirmação de tratamento, acesso,
            correção, anonimização, portabilidade, informação sobre compartilhamento e eliminação de dados. Como a clínica é a
            controladora, os pedidos devem ser direcionados a ela; a Oria dá suporte ao atendimento dessas solicitações.
          </p>
        </section>

        <section id="contato">
          <h2>9. Contato</h2>
          <p>
            Dúvidas sobre privacidade e proteção de dados podem ser encaminhadas ao controlador pelo e-mail
            <strong> [e-mail de contato]</strong>. Esta política pode ser atualizada; a data de revisão é indicada no topo do documento.
          </p>
        </section>

        <div className={styles.footerLinks}>
          <Link href="/">Início</Link>
          <Link href="/dashboard">Entrar na plataforma</Link>
        </div>
      </article>
    </main>
  );
}
