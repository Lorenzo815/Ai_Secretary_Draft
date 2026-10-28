# Oria Platform

Aplicação Next.js da Oria para atendimento administrativo pelo WhatsApp, CRM,
agenda, pagamentos e automação com IA.

## Desenvolvimento

Configure as variáveis de ambiente do MongoDB, NextAuth, WhatsApp, Azure
OpenAI, Mercado Pago, criptografia de PII e worker. Depois execute:

```bash
npm install
npm run seed
npm run dev
```

`npm run dev` inicia o Next.js e o worker do assistente. Para processos
separados, use `npm run dev:next` e `npm run worker:assistant`.

## Agenda

Em `/dashboard/calendario`, abra **Configurar agenda** para definir o
**Intervalo da grade** e a **Duração** de cada tipo de evento com valores
personalizados de **1 a 1440 minutos inteiros**, inclusive. O intervalo da grade
controla a distância entre os horários de início sugeridos; a duração determina
o tempo ocupado pelo evento. Os dois valores são independentes.
Podem ser configurados até **50 tipos de evento**, incluindo os tipos padrão.

A abertura e a atualização automática da agenda carregam configurações e regras
sem buscar a lista completa de clientes nem agendamentos fora do período exibido.
Os clientes são carregados ao abrir o formulário de evento. A API do período
consulta em lote somente os clientes vinculados aos agendamentos.

O seletor de clientes pesquisa no servidor após **300 ms** sem digitação e
retorna **25 clientes por página**, com navegação, ordenação por recentes ou A–Z
e busca por partes do nome sem distinguir maiúsculas ou acentos. Requisições
substituídas são canceladas, e o cliente selecionado permanece disponível mesmo
fora da página atual. O campo de pesquisa é isolado para não redesenhar a agenda
a cada tecla. Os índices de ordenação são inicializados uma vez por processo.

A tabela de eventos renderiza **50 agendamentos por página**, sem limitar os
filtros nem os contadores do período completo. Texto de pesquisa e datas locais
são preparados uma vez por atualização dos dados; formatadores de data e hora
são reutilizados por fuso horário, reduzindo trabalho em computadores modestos.

O nome exibido nos eventos vem de `customer.name` do CRM, tanto para agendamentos
da IA quanto da equipe, e não de `profile.fullName` ou do nome no WhatsApp.
A IA também usa `customer.name` ao salvar novos agendamentos. Eventos sem cliente
vinculado, ou cujo cliente foi excluído, preservam o nome salvo no evento.

## Pagamentos

O **Valor do sinal** é editado somente em **Configurações do sistema → Pagamentos
e sinal via Pix** (`/dashboard/settings/system`). O mesmo valor, de R$ 1,00 a
R$ 10.000,00, é usado para Mercado Pago, modo humano e fallback. O Agent Studio
mostra um resumo somente leitura com um link para essas configurações e
indicadores separados das credenciais Mercado Pago e do Pix manual.

Chave Pix e favorecido são exclusivos do modo humano e fallback e têm um
salvamento independente do valor do sinal. Mercado Pago usa as credenciais da
conta configurada. Alterações não modificam cobranças pendentes nem a
configuração já carregada por uma execução do agente em andamento.

## Assistente

O webhook persiste cada mensagem e publica eventos em uma fila genérica no
MongoDB. Regras de automação podem acionar o agente de atendimento ou a
qualificação independente de leads. O agente usa uma configuração ativa
mutável, identificada por revisão e hash, que é fixada durante todo o job.

Em cada iteração o modelo retorna exatamente uma resposta final ou uma
solicitação de ferramenta. Ferramentas consultam e alteram dados somente no
servidor, com autorização, validação de argumentos, limites de mutação e regras
de negócio determinísticas. Resultados são acumulados até a resposta final ou
até um limite configurado.

O Agent Studio em `/dashboard/fluxos` edita identidade, políticas,
conhecimento, coleta de dados, planos de agenda, ferramentas, limites,
qualificação e automações. A API correspondente é `/api/assistant/studio`.
Segredos Pix não são enviados ao navegador.

Consulte [src/lib/assistant/README.md](src/lib/assistant/README.md) para os
invariantes e pontos de extensão.

## Implantação

Webhooks do WhatsApp devem apontar para `/api/webhooks/whatsapp`. Para
confirmação automática do Pix, cadastre a URL pública
`/api/webhooks/mercado-pago` nas notificações de pagamentos do Mercado Pago.
Configure `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` no
ambiente ou armazene-os pela tela de configurações. O armazenamento no banco
exige `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` com 32 bytes em Base64. Variáveis de
ambiente sempre têm prioridade sobre credenciais armazenadas.

O worker chama
`POST /api/internal/assistant/process` com
`Authorization: Bearer ASSISTANT_WORKER_SECRET`. Em ambientes serverless, use
um agendador externo para invocar a rota ou hospede o worker em um processo
Node contínuo.

Chamadas de modelo que recebem HTTP 429 são repetidas pela camada comum de IA,
independentemente de Azure ou Vercel. A política honra `Retry-After` em segundos
ou data HTTP e usa backoff exponencial quando o header não existe. O padrão é
de 4 tentativas, com espera máxima de 30 segundos entre elas. Ajuste somente se
necessário com `AI_RATE_LIMIT_MAX_ATTEMPTS` (1 a 6) e
`AI_RATE_LIMIT_MAX_DELAY_MS` (1.000 a 120.000). Retries mantêm o mesmo modelo e
provedor; respostas 401, 402 e demais erros não são repetidas.

Follow-ups sem resposta são configurados no Agent Studio. Por padrão, um novo
job é criado a cada 2 horas, com envios entre 08:00 e 20:00 no fuso da clínica,
e expira 24 horas após a última mensagem recebida. Uma nova mensagem ou um
agendamento futuro invalida o follow-up. A frequência do agendador externo
determina o atraso adicional de processamento; use chamadas frequentes quando
a retomada precisar ocorrer próxima do horário configurado.

Tokens e chaves permanecem em variáveis somente de servidor; nunca use o
prefixo `NEXT_PUBLIC_*` para segredos.

### Envio de templates pela integração do WhatsApp

O webhook oficial da Meta, `POST /api/webhooks/whatsapp`, continua exigindo
`X-Hub-Signature-256` calculado com `WHATSAPP_APP_SECRET`. Não substitua essa
assinatura por um Bearer token e não compartilhe o App Secret com integrações.

Para integrações servidor a servidor, use
`POST /api/webhooks/whatsapp/integration` com um token independente:

1. Gere um token aleatório de 32 bytes:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Configure `WHATSAPP_INTEGRATION_WEBHOOK_TOKEN` somente no servidor
   (`.env.local` no desenvolvimento ou variáveis do projeto na Vercel).
   Na Vercel, faça um novo deploy após configurar ou trocar o token.
3. Configure o mesmo token no servidor da integração e envie os headers:

   ```http
   Content-Type: application/json
   Authorization: Bearer <TOKEN_DA_INTEGRACAO>
   ```

Endpoint completo:
`https://ai-secretary-draft.vercel.app/api/webhooks/whatsapp/integration`.
Esta rota agora recebe um **comando de envio**, não um aviso anterior ao envio
nem um envelope de webhook. A alteração substitui o contrato anterior
`object/entry/changes`: esses envelopes passam a retornar 400 nesta rota.
O webhook oficial da Meta permanece inalterado.

Envie `Content-Type: application/json` com este corpo:

```json
{
  "messaging_product": "whatsapp",
  "to": "5542988076200",
  "type": "template",
  "template": {
    "name": "lead_contato",
    "language": { "code": "pt_BR" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "mais informações da consulta" }
        ]
      }
    ]
  }
}
```

O telefone deve conter somente dígitos, com código do país. Nome e idioma
devem corresponder a um único template **APPROVED** no catálogo configurado da
Oria. São suportados parâmetros posicionais de texto em `body`/`header` e
botões de URL dinâmica (`type: "button"`, `sub_type: "url"`, `index` como string
de 0 a 9 e um parâmetro `text`). Botões fixos do template não precisam ser
repetidos. Componentes podem ser omitidos se o template não tiver variáveis.
Cabeçalhos de mídia, parâmetros nomeados e outros componentes não suportados
são rejeitados explicitamente antes do envio.

O provider **não deve enviar a mesma mensagem por conta própria**: a Oria
valida e renderiza o template, encontra/cria o lead e faz o envio pela conexão
WhatsApp configurada no servidor. Não é necessário informar WABA, Phone Number
ID, timestamp ou `wamid`, nem enviar `X-Hub-Signature-256`. O token é exclusivo
da operação da empresa inicial; não habilita múltiplas empresas.

A Oria salva o texto completo, os botões, o destinatário e o `wamid` retornado
pela Meta em `ai_secretary.whatsapp_messages` antes de responder HTTP **201**:

```json
{
  "messaging_product": "whatsapp",
  "messages": [{ "id": "wamid.ID_RETORNADO_PELA_META" }],
  "historySaved": true,
  "message": {
    "messageId": "wamid.ID_RETORNADO_PELA_META",
    "contactPhone": "5542988076200",
    "body": "Texto completo renderizado do template",
    "templateName": "lead_contato",
    "templateLanguage": "pt_BR",
    "status": "sent",
    "timestamp": "2026-10-28T15:00:00.000Z",
    "type": "template",
    "direction": "outbound"
  }
}
```

Esse retorno confirma aceitação pela Meta e persistência, não entrega/leitura
pelo destinatário. O envio não transfere o atendimento para modo humano,
não dispara o agente como se fosse uma mensagem recebida do cliente e não
entra na fila de encaminhamento de eventos originais da Meta. Respostas do
cliente continuam chegando ao webhook oficial e referenciam o `wamid` salvo.
Enviar e salvar são operações separadas; isso não garante ordem absoluta
entre a chegada de um clique muito rápido e a persistência do envio.

Erros: 400 para JSON/payload/parâmetros inválidos; 401 para Bearer ausente ou
inválido; 409 para template indisponível/não aprovado/ambíguo; 415 para
Content-Type diferente de JSON; 503 se o token do servidor não estiver
configurado; 502 para falhas de preparação ou envio não confirmado.
Se a Meta aceitou o envio mas o histórico falhou, o retorno é 503 com
`code: "TEMPLATE_HISTORY_SAVE_FAILED"`, `messageId`, `acceptedByMeta: true`
e `historySaved: false`. Não repita o envio automaticamente nesse caso.
Timeouts/falhas de rede também podem deixar a aceitação do envio incerta.
Esta rota não implementa idempotência de comandos: repetir um POST válido pode
enviar outra mensagem. Desative retries automáticos do provider e confira os
logs antes de repetir uma chamada com resultado incerto.

O Bearer token não é enviado na resposta e deve permanecer fora do navegador,
URLs, logs e repositório. Para revogá-lo, remova ou troque a variável no servidor
e faça um novo deploy.

## Verificação

### Contas, empresa e controle de acesso

Em `/dashboard/settings`, o administrador edita nome, razão social, CNPJ e contatos
da empresa e gerencia até **25 contas no total**, incluindo a própria conta e contas
desativadas. Contas podem ser reativadas, editadas ou excluídas pelo administrador.
A exclusão exige confirmação, libera uma vaga e revoga as sessões da conta, sem
excluir clientes, agendamentos ou históricos operacionais. A conta administradora
não pode ser excluída nem desativada antes de transferir a administração.
O administrador único é definido por `companies.adminUserId`,
não por um papel enviado pelo navegador. A transferência exige a senha atual,
troca esse único vínculo em transação e revoga as sessões das duas contas.

Novos usuários começam sem permissões. Cada módulo admite **Sem acesso / Somente
leitura / Gerenciar**. O proxy Node.js do Next valida no banco cada requisição
protegida, com catálogo explícito de páginas, APIs e métodos HTTP; caminhos novos
ficam bloqueados até serem cadastrados. As APIs administrativas também revalidam
o administrador dentro da transação. Criação de contas e mudanças administrativas
serializam uma escrita no documento da empresa, evitando ultrapassar o limite em
requisições concorrentes. O email permanece globalmente único.

Clientes inclui seu histórico completo, análise e pagamentos. Visão geral tem
permissão independente para os indicadores e resumos do dashboard: não libera
outras páginas ou suas APIs. Sistema inclui
integrações e credenciais; exclusão de dados operacionais é sempre exclusiva do
administrador. Webhooks e execução interna continuam usando suas autenticações
de máquina existentes, sem depender de cookies do dashboard.

Senhas novas usam bcrypt e exigem 12 caracteres, com limite de 72 bytes UTF-8.
Um HMAC do hash armazenado, email, empresa, versão da sessão, estado e permissões
vincula a sessão ao registro atual. Alterar esses dados, inclusive o hash diretamente
no servidor, invalida o token na próxima requisição. Páginas abertas verificam a
sessão a cada 30 segundos enquanto conectadas. Requisições já em execução não são
canceladas retroativamente. JWTs anteriores a esta versão exigem novo login.
NextAuth e proxy compartilham o mesmo nome de cookie de sessão; no Vercel ele é
sempre `__Secure-next-auth.session-token`, mesmo se `NEXTAUTH_URL` tiver sido
copiado de um ambiente HTTP local. Configure a URL oficial HTTPS em produção.
A validação no proxy obtém o cliente com uma chamada explícita a `getMongoClient()`;
isso preserva a conexão tardia e o pool sem depender de métodos `then` implícitos
que podem ser removidos pela otimização do build de produção.

O bootstrap explícito da conta inicial requer backup criptografado com restauração
comprovada e exatamente o usuário existente na empresa:

```powershell
node --env-file=.env.local --import tsx src\scripts\company-user-access.ts --admin-id ID_EXISTENTE --backup CAMINHO_ABSOLUTO --receipt CAMINHO_ABSOLUTO --confirm-production 'ai_secretary:9b9d1f4b4f16cf6e84abcce4'
```

Não há promoção automática no login nem redefinição da senha existente. Esta etapa
continua limitada à empresa inicial: `isolationReady:false`. Não habilite outra
empresa até concluir o isolamento de todas as consultas operacionais.

### Encaminhamento de webhooks do WhatsApp

Em **Configurações do sistema**, o administrador único da empresa pode salvar até
**5 destinos**, incluindo os desativados, e configurar **0 a 10 novas tentativas**
por destino (padrão: 3). A configuração e os testes usam
`GET/PUT/POST /api/company/webhook-forwarding`, protegidos no proxy e nos handlers:
permissão de gerenciar Sistema, sem ser administrador, não autoriza essa função.
O servidor deriva `companyId` da sessão validada, nunca do corpo da solicitação.
Alterações são serializadas com as demais ações administrativas e usam revisão
otimista para não sobrescrever outra edição.

Somente POSTs com assinatura válida em `/api/webhooks/whatsapp` são encaminhados.
Os bytes originais são persistidos e enviados sem reconstruir, filtrar ou enriquecer
o JSON; isso inclui campos/eventos desconhecidos e referências de mídia, não o
download dos arquivos. A assinatura original `X-Hub-Signature-256` é preservada.
Cookies, tokens de login e demais cabeçalhos de entrada não são repassados.
GETs de verificação da Meta e chamadas ao cron não são encaminhados.

A empresa do evento é resolvida pelos WABA/Phone Number IDs das conexões
registradas; a configuração em ambiente só associa identificadores explicitamente
correspondentes à empresa inicial. Nunca há fallback para a configuração de outra
empresa. A ativação exige antes uma conexão WhatsApp vinculada à empresa ou os
identificadores explícitos da empresa inicial no ambiente. Quando existem destinos ativos, um payload com propriedade desconhecida
ou misturando empresas recebe 503, com diagnóstico sanitizado nos logs, em vez de
vazar dados ou alterar o objeto para dividi-lo. Esta funcionalidade não habilita
outras empresas nem substitui o isolamento operacional ainda pendente.

O outbox durável em `whatsapp_forwarding_deliveries` é escrito antes do
processamento local/acknowledgement à Meta. Uma chave única por empresa, destino e
SHA-256 do corpo evita duplicações na janela de retenção. As primeiras entregas
rodam após a resposta; novas tentativas são drenadas pelo **mesmo cron autenticado**
`POST /api/internal/assistant/process`, inclusive com a IA pausada, e sem atrasar
o início dos jobs de IA. Mantenha esse agendamento ativo; não foi adicionado outro
serviço de agendamento. Cada execução reivindica até 5 entregas vencidas, com
concessão e token de concorrência.

Somente **HTTP 200** conta como aceitação; outros status, falhas de rede e timeout
de 8 segundos consomem tentativas. A espera progride de 30 segundos até 1 hora.
O limite é capturado na criação da entrega: uma tentativa inicial mais o máximo
de novas tentativas. Antes de enviar, o worker cancela pendências cujo destino
foi removido, está desativado ou está com outra URL. Uma requisição em andamento não pode ser
recolhida. A entrega é **pelo menos uma vez**: após uma falha ambígua, o receptor
deve deduplicar pelo `X-Oria-Delivery-Id`, estável nas novas tentativas.

Os destinos exigem HTTPS público na porta 443, certificado válido e nenhum
redirecionamento. Endereços locais, privados, reservados, respostas DNS mistas e
o próprio ambiente são bloqueados. O transporte fixa o IP público validado,
preservando Host e TLS SNI para impedir troca de DNS durante a conexão.
`X-Oria-Webhook-Forwarded: 1` identifica encaminhamentos; a entrada rejeita ciclos.

**Testar HTTP 200** envia somente um objeto sintético
`{"object":"whatsapp_business_account","entry":[]}`, identificado por
`X-Oria-Webhook-Test: 1`, sem dados reais de clientes e sem novas tentativas.
O teste funciona com o destino salvo ainda desativado, permitindo verificá-lo antes
de enviar eventos reais. O status, duração e erro são exibidos. Existe um intervalo mínimo de 5 segundos
entre testes da empresa. HTTP 200 comprova aceitação, não o processamento interno
da plataforma de destino; a assinatura do teste usa o app secret quando disponível.

As últimas 25 entregas/testes da própria empresa mostram status, tentativas e
próximo horário. Corpos e assinaturas são removidos após conclusão, falha terminal
ou cancelamento; metadados terminais expiram após 7 dias. Pendências mantêm o corpo
para recuperação pelo worker. A configuração fica em
`whatsapp_forwarding_config`; ambas as coleções têm propriedade da empresa.

### Conversas do WhatsApp Business/Web

Eventos `smb_message_echoes` recebidos da Meta alimentam o mesmo histórico usado
pela conversa do cliente e pela IA. O destinatário `to` identifica o cliente;
WABA e Phone Number ID precisam corresponder a uma conexão registrada da empresa
ou aos identificadores explícitos da empresa inicial no ambiente. Esta ingestão
continua restrita à empresa inicial ativa, sem habilitar isolamento multiempresa.

Mensagens externas aparecem como **WhatsApp Business/Web**. IDs da Meta deduplicam
entregas, preservando mensagens já enviadas pela Oria/equipe. Texto, referências
de mídia e respostas citadas são preservados. Edições e revogações atualizam a
mensagem original; uma revogação não restaura conteúdo com uma edição atrasada.
O evento bruto permanece arquivado. Arquivos de mídia não são copiados da Meta.

O mesmo cron autenticado `POST /api/internal/assistant/process` recupera até
100 eventos arquivados por execução, inclusive com a IA pausada. Não envia
mensagens nem dispara automações ao importar ecos antigos. `processedAt` só é
gravado após a projeção completa; falhas ficam pendentes para nova tentativa,
com diagnóstico sanitizado e HTTP 503 no worker. A resposta inclui
`echoesProcessed` e `echoSyncFailures`. Não é necessário outro agendamento,
re-onboarding ou uma chamada de histórico por contato à Meta.
Falhas aguardam pelo menos 60 segundos entre tentativas; eventos ainda não
tentados têm prioridade para que um evento problemático não bloqueie o restante
do arquivo.

Antes de carregar o contexto e antes de mutações/envio, o agente reconcilia
pendências do contato e verifica alterações externas. Se houver resposta manual
desde a última mensagem recebida, descarta a resposta/follow-up pendente e
aguarda a próxima mensagem do cliente, sem alterar permanentemente `serviceStatus`.
Outras alterações de contexto adiam o job para releitura; falhas de sincronização
impedem uma resposta baseada em histórico incompleto. O atendimento humano já
ativado na Oria mantém suas regras atuais.

A sincronização depende dos eventos entregues pela Meta e dos dispositivos
compatíveis com Coexistence; não é um espelho instantâneo/completo do servidor
nem uma importação genérica de todo o histórico anterior. Uma chamada de envio
ou mutação já iniciada não pode ser cancelada retroativamente.

### Contexto de anúncios do Instagram/Facebook

Mensagens recebidas por anúncios Click-to-WhatsApp preservam o objeto `referral`
enviado pela Meta junto à mensagem do cliente: origem/ID/link, título, texto,
tipo e links de mídia, `ctwa_clid`, `ref` e a saudação em
`welcome_message.text`, quando presentes. Esses dados ficam no campo `referral`
da mensagem, com nomes camelCase; a saudação é `welcomeMessage`.

O histórico do cliente e a caixa de conversas mostram um cartão de origem com
texto, saudação e detalhes expansíveis. A mensagem digitada pelo cliente permanece
inalterada. A saudação do anúncio não é criada como uma mensagem fictícia da
equipe/Oria, nem um segundo gatilho de automação. Links de mídia ficam disponíveis
para abertura manual; não são baixados automaticamente.

A IA recebe o título/texto/saudação e a referência de origem, com limites de
tamanho, como dados externos de contexto. Isso ajuda a entender pedidos como
“quero saber mais sobre o projeto verão”, sem tratar anúncios como autorização
de preços, promessas clínicas ou alterações de cadastro/agenda/pagamento. Não há
leitura automática de imagens/vídeos nem inferência de detalhes ausentes.

Esse suporte depende dos campos efetivamente entregues pela Meta. Não exige um
modelo aprovado da WABA nem busca na Marketing API. Mensagens antigas cujo
`referral` não foi salvo não são reconstruídas por `wamid`, e a interface não
presume Instagram em vez de Facebook quando a origem não informa isso.

Referência oficial:
[Text messages webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text).

### Contexto de modelos e respostas a botões

O worker existente consulta proativamente o catálogo da WABA da empresa inicial,
inclusive com a IA pausada. O cache em memória dura 15 minutos por empresa/WABA/
versão da Graph API; instâncias novas recarregam o catálogo sob demanda. A listagem
segue todas as páginas por cursor na mesma origem da Graph API e não trunca
silenciosamente os primeiros 100 modelos. Criar um modelo na Oria invalida o cache.
Falhas de atualização são registradas sem tokens/conteúdo e retornam HTTP 503 após
aguardar os demais trabalhos do worker. Novas consultas ao catálogo aguardam pelo
menos 60 segundos após uma falha, sem substituir o erro por um catálogo vazio.

Se um evento realmente incluir `type: "template"` e `template` com `id` ou
`name` + `language.code`, a Oria consulta somente o catálogo da WABA correspondente.
`components[].parameters` deve conter os valores efetivamente usados no envio:
texto, `currency.fallback_value` ou `date_time.fallback_value`, com
`parameter_name` quando o modelo usa variáveis nomeadas. Cabeçalho textual,
corpo, rodapé e rótulos de botões compõem o texto armazenado e o contexto da IA.
Cabeçalhos de mídia são identificados pelo formato, sem inventar texto do arquivo.
Modelos, variáveis ou componentes ausentes/ambíguos/não suportados causam erro
explícito; exemplos do catálogo nunca substituem valores reais. Ecos que não
puderem ser enriquecidos permanecem pendentes para recuperação.

Envios pela própria Oria já conhecem os valores e passam pelo mesmo renderizador
antes de enviar, preservando também as opções no histórico. Isso inclui o endpoint
legado de demonstração, que agora exige o modelo aprovado correspondente na WABA
da empresa e não registra uma descrição aproximada como se fosse o texto enviado.
Respostas recebidas
de botões/listas guardam rótulo, ID/payload e referência à mensagem original.
A IA recebe esses dados e não deve adivinhar o contexto quando o original falta.

**Limite importante:** este suporte é condicional à presença desses dados no
evento; `smb_message_echoes` não garante sua entrega para envios feitos via Cloud
API por outro provedor. Um `context.id`/`wamid` sozinho não identifica o modelo
nem permite baixar seu texto final. Ter o modelo na mesma empresa não revela
quais valores o outro provedor usou. A integração de templates descrita acima
resolve o envio pela própria Oria com os parâmetros informados pelo provider;
não tenta reconstruir um envio externo a partir do ID apenas.

### Ferramentas de migração de propriedade

O CLI `src\scripts\company-ownership.ts` **não executa migração automaticamente**:
sem comando, faz somente `dry-run`. Não habilita isolamento/múltiplas empresas.
Esta fase adiciona **somente metadados**: não implementa isolamento de leituras
por tenant nem isolamento de autorização e não habilita uma nova empresa.
IDs originais, inclusive IDs em string e ObjectIds, mantêm seus tipos/valores;
índices existentes e definições/funcionamento de TTL em produção são preservados.
Não usa repositórios da aplicação, não corrige referências órfãs, não altera
campos de negócio, timestamps, revisões/hashes, documentos ou índices existentes.
`bootstrap` insere somente a empresa inicial (`isolationReady:false`); `apply`
adiciona somente `companyId` ausente, com guardas e transações de até 200 documentos.
Cada transação compara BSON antes/depois, omitindo apenas o novo campo; qualquer
diferença aborta aquela transação. Transações já concluídas permanecem aplicadas
se houver falha posterior; a execução é retomável/idempotente.

As novas escritas e substituições completas atribuem a empresa inicial no servidor;
metadados de propriedade enviados por clientes não controlam essa atribuição nem
compõem hashes de configuração. Essa ponte é transitória, não um resolvedor de tenants.
Use `dry-run` e `verify` para confirmar a cobertura no ambiente de destino.
O ensaio de `apply` em scratch não equivale a executar `apply` em produção.

Pré-requisitos: MongoDB **5+ em replica set ou mongos**, sessões snapshot,
transações e permissões de leitura do catálogo. Não há fallback sem snapshot.
`restore-test` precisa criar/escrever/indexar/remover um banco isolado e listar
bancos para confirmar sua ausência antes/depois. Opcionalmente configure
`COMPANY_MIGRATION_RESTORE_URI` com um **destino separado compatível**; a origem
continua vinculada ao `MONGODB_URI` exato usado no backup. Não coloque URIs
ou chaves na linha de comando.

Forneça `COMPANY_MIGRATION_BACKUP_KEY` via ambiente: **32 bytes aleatórios em
Base64 canônico**. Armazene a chave separadamente, protegida por DPAPI/gerenciador
de segredos; perdê-la torna o backup irrecuperável. Use diretório local privado
com ACL restritiva, **fora do repositório**. Arquivos existentes nunca são
sobrescritos. Backup/recibo não devem ser colocados em pasta pública/sincronizada.
A cópia local da chave protegida por **Windows DPAPI** permanece vinculada ao
usuário/perfil Windows e à máquina atuais; não presuma recuperação em outro
usuário/computador. O caminho privado e o arquivo de chave não são versionados.
Retenha tanto o material de chave recuperável quanto o backup criptografado,
protegidos e separados. DPAPI local não oferece escrow entre máquinas e este
backup não substitui os backups/snapshots independentes do provedor.

Exemplo PowerShell, executado em `platform` após fornecer a chave por ambiente
e configurar `MONGODB_URI` no `.env.local`. Defina
`COMPANY_MIGRATION_BACKUP_DIRECTORY` somente no ambiente local com o diretório
privado existente, fora do repositório; não versione esse caminho:

```powershell
$backup = Join-Path $env:COMPANY_MIGRATION_BACKUP_DIRECTORY 'snapshot.bson.aes'
$proof = Join-Path $env:COMPANY_MIGRATION_BACKUP_DIRECTORY 'restore-proof.json'
$cli = @('--env-file=.env.local', '--import', 'tsx', 'src\scripts\company-ownership.ts')
node @cli backup --backup $backup
node @cli restore-test --backup $backup --receipt $proof
node @cli dry-run
node @cli bootstrap --backup $backup --receipt $proof --company-name 'Empresa atual' --confirm-production 'ai_secretary:9b9d1f4b4f16cf6e84abcce4'
# PARAR: implantar/validar a inclusão de companyId nas novas escritas antes de apply.
node @cli apply --backup $backup --receipt $proof --confirm-production 'ai_secretary:9b9d1f4b4f16cf6e84abcce4'
node @cli verify
```

`backup` usa uma única sessão snapshot para todos os documentos, BSON bruto
com validação de round-trip sem promoção numérica, manifesto SHA256/contagens
e catálogo/índices completos. Tudo é criptografado em fluxo AES-256-GCM;
nenhum conteúdo de documento ou segredo é impresso. A criação do backup por si
só **não comprova recuperação**.

`restore-test` autentica o arquivo completo, cria somente um banco com nome
aleatório `cmr_<32 hex>` (36 bytes ASCII, abaixo do limite de 38 bytes do Atlas
shared, mantendo 128 bits aleatórios), restaura documentos e índices não TTL,
compara hashes BSON/contagens e metadados de índices, ensaia dry-run/bootstrap/
apply/segunda execução e verifica preservação dos campos originais. Os índices
TTL ficam **apenas no backup**, nunca no banco de ensaio, para impedir exclusões.
Coleções/opções não suportadas, BSON que não possa ser preservado exatamente,
propriedade divergente/nula/inválida ou uma segunda empresa bloqueiam o processo.
Dados que passaram a existir ou mudar depois do snapshot não estão nesse backup:
ele não é um rollback automático das escritas posteriores.

O recibo autenticado só é gravado após esse ensaio **e a limpeza confirmada**
do banco criado pela própria ferramenta. Bootstrap/apply exigem tanto o arquivo
original íntegro quanto o recibo, vinculados ao hash, banco, empresa e conexão de
origem por HMAC-SHA256 da URI com a chave de backup (sem persistir/imprimir URI
ou credenciais); uma flag de confirmação não substitui essa prova. Mudança na URI exige
novo backup/ensaio. Sem recibo válido, falha fechada antes de conectar para
mutação. Não há comando de restauração sobre produção. Se a limpeza do ensaio
falhar, não há recibo: inspecione o banco aleatório/marker antes de qualquer
limpeza administrativa; a ferramenta nunca remove banco sem sua própria marca.
Falhas do CLI produzem somente JSON sanitizado com `stage`, `safetyErrorId`
estável e, se disponíveis, `mongoCode` numérico/`mongoCodeName`; nunca mensagens
brutas, stack, registros, URIs ou conteúdo de arquivos. O relatório identifica
o prefixo/banco aleatório de ensaio e `cleanup`: `not-created` (esta execução não
iniciou criação), `not-confirmed` (pode exigir inspeção administrativa) ou
`confirmed`. Falha na criação/inserção do marker não garante limpeza; após o
marker, a limpeza é tentada em `finally`, mas uma falha nela impede recibo e
reporta separadamente a etapa/código anteriores.

```bash
npm test
npm run lint
npm exec tsc -- --noEmit
npm run build
```
# Transcrição de áudio do WhatsApp

Para que áudios recebidos pelo WhatsApp sejam transcritos para a IA, selecione um
modelo em **Configurações do sistema → Modelos de IA → Transcrição de áudios**.
A lista é carregada do catálogo do Vercel AI Gateway e usa a mesma credencial
Vercel configurada nessa página. O modelo padrão é
`openai/gpt-4o-mini-transcribe`.

O áudio permanece salvo e reproduzível no histórico quando a transcrição não
está disponível; nesse caso, a IA não infere o conteúdo e solicita uma mensagem
em texto.
