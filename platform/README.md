# How to handle ai generation 

Once the webhook hit our endpoiint we can maybe use that to trigger a generation with some buffer for wait for user digitations? lets say 10 seconds?

# Oria Platform

Aplicação principal da Oria, uma secretária com IA voltada inicialmente para
agendamentos e acompanhamentos de clientes pelo WhatsApp.

## Estado atual

A plataforma persiste CRM, conversas, fluxos, pagamentos e agenda no MongoDB.
O assistente conduz identificação, cadastro, informações comerciais, solicitação
de sinal via Pix e agendamento da primeira visita. Consulte [MVP.md](MVP.md)
para o escopo do produto.

## Desenvolvimento

Copie as chaves de `.env.example` para `.env.local` e preencha os valores.
Depois:

```bash
npm install
npm run seed
npm run dev
```

## PWA

O app pode ser instalado no desktop, Android e iOS. O manifest, favicon e
ícones usam a identidade visual Oria; o service worker oferece uma tela de
indisponibilidade quando não há conexão. Por segurança, respostas de API e
páginas autenticadas do CRM nunca são armazenadas no cache offline. Apenas a
tela offline e recursos visuais estáticos são persistidos no dispositivo.

Abra [http://localhost:3000](http://localhost:3000).

## Implantação na Vercel

O processamento deve funcionar no servidor sem depender de uma pessoa manter o
site aberto no navegador. Webhooks do WhatsApp chegam diretamente às rotas da
aplicação e enfileiram respostas para processamento server-side.

Atualmente, `npm run dev` e `npm start` iniciam o Next.js e um worker contínuo.
Esse worker funciona em servidores Node tradicionais, mas não permanece ativo
em uma implantação serverless da Vercel.

Em uma implantação serverless, configure uma chamada recorrente à rota interna
do worker ou use uma infraestrutura Node que mantenha o processo contínuo.

## WhatsApp Business

A demonstração usa uma configuração única no servidor. Preencha estas
variáveis em `.env.local`:

- `WHATSAPP_PHONE_NUMBER_ID`: ID do número fornecido pela Meta
- `WHATSAPP_ACCESS_TOKEN`: token de acesso, somente no servidor
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: segredo escolhido para validar o webhook
- `WHATSAPP_APP_SECRET`: segredo do aplicativo para validar assinaturas
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: opcional nesta primeira versão

No painel da Meta, configure o callback público
`https://SEU-DOMINIO/api/webhooks/whatsapp`, use o mesmo token de verificação e
assine o campo `messages`. Em desenvolvimento, o callback precisa ser
publicado por uma URL HTTPS; `localhost` não pode ser acessado pela Meta.

A Cloud API não fornece importação retroativa de conversas. O endpoint
`GET /api/whatsapp/messages` consulta somente o histórico armazenado pela Oria
desde a ativação do webhook. Nesta demonstração, a configuração e o histórico
são compartilhados por todos os usuários autenticados; isolamento por empresa
deve ser implementado antes de uso multi-tenant.

Nunca coloque o token da Meta no código ou em uma variável `NEXT_PUBLIC_*`.

## Assistente automático

O webhook apenas persiste a mensagem e renova um job no MongoDB. Um worker
separado chama `POST /api/internal/assistant/process` com o header
`Authorization: Bearer ASSISTANT_WORKER_SECRET`. O projeto inclui esse processo:

```bash
npm run worker:assistant
```

`npm run dev` e `npm start` iniciam automaticamente o servidor Next.js e o
worker no mesmo supervisor. O worker lê `ASSISTANT_WORKER_URL`, `ASSISTANT_WORKER_INTERVAL_MS` e
`ASSISTANT_WORKER_REQUEST_TIMEOUT_MS`. Cada requisição processa um job por padrão;
`ASSISTANT_MODEL_REQUEST_TIMEOUT_MS` limita cada inferência e `ASSISTANT_LEASE_MS`
deve permanecer maior que o timeout total do worker. `ASSISTANT_WORKER_ENABLED=false` o
desativa. Os comandos `npm run dev:next`, `npm run start:next` e
`npm run worker:assistant` permanecem disponíveis quando a implantação exige
processos separados. Várias instâncias podem trabalhar em paralelo porque cada
job usa lease e revisão atômicos.

O Azure OpenAI usa o pacote oficial `openai@6.16.0`, o deployment
`gpt-5.4-mini` e a API `2024-12-01-preview`. Configure as variáveis
`AZURE_OPENAI_*` e `ASSISTANT_WORKER_SECRET`.
Nunca exponha essas variáveis com o prefixo `NEXT_PUBLIC_*`.

O contexto enviado ao modelo combina um resumo persistido com uma janela
recente limitada. Respostas fora do escopo, emergências e encaminhamentos são
substituídos por textos determinísticos antes do envio. Consulte
[ASSISTANT.md](ASSISTANT.md) para o fluxo completo e os limites operacionais.

Prompts e conhecimento da clínica são configurados visualmente em
`/dashboard/fluxos`. Cada publicação cria uma versão; clientes em andamento
continuam na versão que receberam até uma transição ou atribuição manual.

## Fluxos de IA atuais

O sistema possui cinco fluxos iniciais. Cada cliente participa de apenas um
fluxo por vez. As chaves são estáveis, enquanto prompts, conhecimento e regras
podem receber novas versões pelo editor do CRM.

### Jornada padrão

- `initial_triage`: pergunta explicitamente se é a primeira consulta. Pacientes
  de retorno são encaminhados para atendimento humano.
- `collect_profile`: coleta gradualmente nome completo, nascimento, CPF,
  endereço, telefones e profissão.
- `commercial_information`: responde com o conteúdo comercial aprovado e sem
  pressão, promessa de resultado ou alegação médica não confirmada.
- `payment_confirmation`: cria uma solicitação do sinal com os dados Pix
  configurados. A equipe confirma ou rejeita o pagamento na ficha do cliente.
- `schedule_appointment`: oferece uma única combinação por vez e agenda
  Bioimpedância antes da Consulta Dr., juntas ou separadas conforme preferência.

O médico e a técnica de Bioimpedância têm recursos e expedientes independentes.
Os dois eventos são reservados pelo servidor com um mesmo identificador de
visita; se a segunda gravação falhar, a primeira é removida. O tipo `follow_up`
continua disponível na agenda como "Retorno".

### Dados pessoais e Pix

O CRM é a fonte autoritativa do cadastro. O CPF é validado, cifrado com
AES-256-GCM usando `PII_ENCRYPTION_KEY`, indexado por HMAC e exibido ao modelo e
à equipe apenas mascarado. CPF completo não pode permanecer no estado, resumo,
resposta ou auditoria do assistente. Em desenvolvimento, `NEXTAUTH_SECRET` é
aceito como fallback, mas produção deve usar uma chave de PII independente.

Chave Pix, favorecido e valor do sinal são configurados em
`/dashboard/settings`. Sem esses dados, a ferramenta de pagamento falha sem
inventar valores. A solicitação apenas registra pagamento pendente e transfere
o atendimento; somente a confirmação humana libera o fluxo de agendamento.

### Saída estruturada comum

Toda execução da IA retorna um JSON validado pelo servidor com:

- `decision`: `reply`, `out_of_scope`, `emergency` ou `human_handoff`.
- `reply`: texto proposto para o cliente.
- `updatedSummary`: resumo factual acumulado da conversa.
- `state`: etapa atual, dados coletados, dados pendentes e observações.
- `transition`: ação `stay`, `complete` ou `transition`, acompanhada de destino,
	código e motivo quando aplicável. O campo `continueImmediately` informa se o
	fluxo de destino deve processar a mesma mensagem sem aguardar o cliente.

O servidor só aplica destinos autorizados pela versão ativa. Cada job é limitado
a no máximo duas chamadas reais ao modelo sem intervenção do usuário, evitando
ciclos de transição. Quando a segunda chamada executa uma ferramenta com sucesso,
o resultado determinístico da ferramenta produz a resposta sem uma terceira
inferência. Somente a
resposta final é enviada ao cliente; respostas intermediárias existem apenas para
a decisão estruturada de transição. Cada execução é registrada em
`assistant_flow_runs` com `deliveryStatus` igual a `internal_transition` ou
`sent`; conclusões e mudanças de fluxo ficam em
`assistant_flow_history` com versão, motivo, origem, estado final e próximo
fluxo. A política global de segurança permanece no código e não pode ser
alterada pelo editor de prompts.

## Verificação

```bash
npm run lint
npm run build
```
