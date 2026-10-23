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

O bootstrap explícito da conta inicial requer backup criptografado com restauração
comprovada e exatamente o usuário existente na empresa:

```powershell
node --env-file=.env.local --import tsx src\scripts\company-user-access.ts --admin-id ID_EXISTENTE --backup CAMINHO_ABSOLUTO --receipt CAMINHO_ABSOLUTO --confirm-production 'ai_secretary:9b9d1f4b4f16cf6e84abcce4'
```

Não há promoção automática no login nem redefinição da senha existente. Esta etapa
continua limitada à empresa inicial: `isolationReady:false`. Não habilite outra
empresa até concluir o isolamento de todas as consultas operacionais.

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
