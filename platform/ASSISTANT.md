# Sistema de respostas automáticas

Referência de implementação: [`src/lib/assistant/README.md`](src/lib/assistant/README.md).
Guias de extensão: [`tools/README.md`](src/lib/assistant/tools/README.md) e
[`flows/README.md`](src/lib/assistant/flows/README.md). A decisão do contrato
genérico está em [`docs/architecture/assistant-tool-contract.md`](docs/architecture/assistant-tool-contract.md).

## Fluxo

1. O webhook valida e normaliza o evento recebido.
2. `saveWhatsAppMessage` faz upsert por `metaMessageId` e informa se a mensagem
   é realmente nova.
3. Uma mensagem nova chama `scheduleAssistantResponse`. Existe no máximo um
   job por cliente; novas mensagens incrementam sua revisão e movem `dueAt`.
4. Um worker autorizado chama `POST /api/internal/assistant/process`.
5. O worker reivindica um job vencido com lease atômico.
6. O contexto combina o resumo da conversa com até 40 mensagens recentes.
7. O Azure OpenAI classifica o pedido e propõe resposta, resumo, estado e
   transição em JSON estruturado.
8. A política local escolhe a resposta final. Emergência, fora de escopo e
   encaminhamento nunca usam diretamente o texto livre do modelo.
9. Antes do envio, o worker confirma que a revisão não mudou. Se outra mensagem
   chegou durante a geração, descarta o resultado e aguarda o novo debounce.
10. A resposta é enviada pela Meta, o resumo é atualizado e o job concluído.

## Organização

- `src/lib/assistant/config.ts`: configuração privada e valores padrão.
- `src/lib/assistant/queue.ts`: debounce, revisão, lease e retentativas.
- `src/lib/assistant/context.ts`: resumo persistido e janela recente.
- `src/lib/assistant/flows.ts`: versões, atribuição, estado, histórico e auditoria.
- `src/lib/assistant/prompt.ts`: escopo, política e validação da saída JSON.
- `src/lib/assistant/azure-openai.ts`: único ponto que chama o modelo.
- `src/lib/assistant/processor.ts`: orquestra uma execução completa.
- `src/app/api/internal/assistant/process/route.ts`: entrada privada do worker.

## Escala e confiabilidade

O webhook não espera o modelo e pode responder rapidamente à Meta. A fila no
MongoDB permite vários workers; o lease recupera jobs abandonados e a revisão
evita respostas baseadas em blocos incompletos. Falhas usam backoff exponencial
e, após cinco tentativas consecutivas, o job fica `failed`. Uma nova mensagem
reativa esse job.

Para produção, use um processo contínuo ou timer com cadência de poucos
segundos. Não use timers em memória dentro do processo Next.js. Monitore jobs
`failed`, latência entre `dueAt` e claim, erros do modelo e erros da Meta.

O envio à API da Meta e a gravação local não formam uma transação única. Uma
queda exatamente entre essas operações ainda pode exigir reconciliação. Antes
de alto volume, adicione uma outbox de envio e alerta para estados incertos.

## Segurança

- Mensagens e resumos são tratados como entrada não confiável.
- O modelo propõe chamadas estruturadas, mas somente o servidor valida e
   executa ferramentas e efeitos externos.
- O escopo é somente administrativo; não há diagnóstico ou orientação médica.
- Dados da clínica vêm da versão do fluxo publicada no CRM.
- O CRM é a fonte autoritativa para cadastro; CPF é validado, cifrado, indexado
   por HMAC e fornecido ao modelo apenas mascarado.
- Pagamentos dependem dos dados Pix configurados e confirmação humana na ficha
   do cliente.
- Disponibilidade e reservas são confirmadas somente por ferramentas do
   servidor.
- Saídas são JSON validado e limitadas ao tamanho aceito pelo WhatsApp.
- Emergências e recusas usam respostas locais fixas.

## Fluxos e metadados

Cada cliente possui um único documento em `assistant_customer_flows`, que
representa seu fluxo atual e estado estruturado. As definições ficam em
`assistant_flows`; cada publicação acrescenta uma versão imutável. Assim, uma
mudança de prompt não altera retrospectivamente atendimentos em andamento.

Toda resposta gera um registro em `assistant_flow_runs` com decisão, texto
enviado, estado, versão e transição sugerida. Conclusões e transferências são
copiadas para `assistant_flow_history` com código, motivo, origem e próximo
fluxo. A IA só pode transicionar para chaves permitidas na versão atribuída;
essa regra é validada pelo servidor, não pelo prompt.

## Continuidade do diálogo

Mat conduz um passo por mensagem, com linguagem natural, breve e consultiva.
Quando depende de uma resposta do cliente, a mensagem termina com uma única
pergunta direta usando `?`; convites vagos como "se quiser" ou "é só me chamar"
não são usados como próximo passo.

Essa regra existe no prompt e também no servidor. Se uma resposta que precisa
do cliente não terminar em pergunta, `ensureExplicitNextQuestion` acrescenta a
pergunta segura do fluxo ou do primeiro campo cadastral pendente. Identificação,
cadastro e conversa comercial também não podem ser concluídos prematuramente:
o servidor os mantém ativos ou aplica a próxima transição válida.

Na etapa comercial, informações são apresentadas progressivamente conforme a
dúvida explícita. Pedidos amplos recebem uma visão geral curta e uma pergunta
sobre o interesse principal, em vez de uma lista completa de preços e regras.
Uma pergunta sempre implica `continueImmediately=false`; o fluxo aguarda uma
nova mensagem antes de prosseguir.

## Ferramentas

As ferramentas do assistente ficam em `src/lib/assistant/tools`. O arquivo
`index.ts` é a entrada usada pelo processador; cada integração mantém contrato,
validação e execução em seu próprio módulo. Erros de validação voltam ao modelo
para correção dos argumentos. Erros operacionais não são tratados como sucesso.

`calendar.find_first_visit_option` recebe:

- `fromDate` e `toDate`: datas `YYYY-MM-DD`;
- `period`: `morning`, `afternoon` ou `any`;
- `preference`: `together` ou `separate`.

A ferramenta procura a Bioimpedância no recurso da técnica e a Consulta Dr. no
recurso do médico, sempre nessa ordem, persiste uma única opção por 24 horas e
exclui pares já oferecidos. A opção proposta mais recente é recuperada do banco
e incluída no contexto de cada geração.

`calendar.book_first_visit` recebe o `optionId` persistido e
`confirmedByCustomer=true`. O servidor revalida os dois horários, grava ambos
com um `visitGroupId` e compensa uma falha parcial removendo a primeira reserva.

Os fluxos iniciais são `initial_triage`, `collect_profile`,
`commercial_information`, `payment_confirmation` e `schedule_appointment`.
Eles podem ser editados em `/dashboard/fluxos`. Na ficha de cada cliente é
possível trocar o fluxo manualmente, sempre informando um motivo auditável.

`payment.request_deposit` cria uma solicitação pendente e coloca o cliente em
espera humana. A confirmação autenticada na ficha atribui o fluxo de agenda e
envia uma mensagem determinística pedindo a preferência por horários juntos ou
separados; a rejeição mantém o atendimento com a equipe.

Existe exatamente um fluxo default persistido em `assistant_settings`; novos
clientes começam nele, sem alterar clientes já atribuídos. O mesmo documento
mantém as políticas globais de comportamento, ofensas e encaminhamento humano.
A política estrutural de segurança permanece protegida no código.

Cada versão de fluxo escolhe um lifecycle `single_call` ou `tool_cycle`. Fluxos
de chamada única não recebem instruções nem ações de ferramentas. No ciclo com
tools, a pré-chamada pode solicitar somente itens de `allowedTools`, o servidor
valida e executa a ação, e a pós-chamada recebe o resultado real com um schema
que impede nova chamada. Prompts e JSON Schemas completos de cada etapa são
gerados pelas mesmas funções usadas em produção e ficam visíveis no editor.

Prompt injection não pode ser eliminada apenas com prompt. Antes de permitir
agendamentos reais, pagamentos ou acesso a prontuário, mantenha autorização e
validação determinísticas fora do modelo, registre auditoria e exija confirmação
humana para ações sensíveis.

## Operação local

Depois de preencher `.env.local`, envie uma mensagem pelo WhatsApp e execute:

```bash
curl -X POST http://localhost:3000/api/internal/assistant/process \
   -H "Authorization: Bearer $ASSISTANT_WORKER_SECRET"
```