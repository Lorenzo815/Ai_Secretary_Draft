# Sistema de respostas automáticas

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
10. A resposta é enviada pela Meta ou persistida localmente no simulador. O
    resumo é atualizado e o job concluído.

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

## Ferramentas

As ferramentas do assistente ficam em `src/lib/assistant/tools`. O arquivo
`index.ts` é a entrada usada pelo processador; cada integração mantém contrato,
validação e execução em seu próprio módulo. Erros de validação voltam ao modelo
para correção dos argumentos. Erros operacionais não são tratados como sucesso.

`calendar.check_availability` recebe:

- `dateIntent`: `exact_date`, `date_range` ou `next_available`;
- `fromDate` e `toDate`: datas `YYYY-MM-DD` já calculadas pelo modelo;
- `period`: `morning`, `afternoon` ou `any`;
- `notes`: contexto administrativo opcional.

Para `exact_date`, as duas datas devem ser iguais. Para `next_available`, a
janela deve ter entre 7 e 31 dias. Expressões como "próximo", "último dia da
semana" e "semana que vem" são interpretadas pelo modelo usando a data e o fuso
fornecidos no prompt, não por regex no servidor.

`calendar.book_appointment` recebe `startAt` em ISO 8601 com offset,
`confirmedByCustomer=true` e `notes` opcional. A reserva só ocorre depois da
confirmação explícita de um horário retornado pela agenda.

Os fluxos iniciais são `initial_triage`, `schedule_appointment` e `follow_up`.
Eles podem ser editados em `/dashboard/fluxos`. Na ficha de cada cliente é
possível trocar o fluxo manualmente, sempre informando um motivo auditável.

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

Depois de preencher `.env.local`, envie mensagens pelo simulador e execute:

```bash
curl -X POST http://localhost:3000/api/internal/assistant/process \
  -H "Authorization: Bearer $ASSISTANT_WORKER_SECRET"
```

O simulador grava a resposta no histórico sem chamar a Meta. Mensagens de
origem `meta` usam a WhatsApp Cloud API.