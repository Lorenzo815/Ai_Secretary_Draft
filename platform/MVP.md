# MVP da Oria

## Objetivo

Validar se pequenos negócios conseguem reduzir trabalho manual usando o
WhatsApp para duas tarefas: marcar o primeiro atendimento e fazer
acompanhamentos. Pagamentos via PIX não fazem parte desta etapa.

## O que funciona hoje

- Login por email e senha
- Sessão autenticada e proteção das rotas do dashboard
- Usuários armazenados no MongoDB
- Nome e email da conta carregados da sessão no servidor
- Envio de template pela WhatsApp Cloud API
- Recebimento de mensagens e status por webhook
- Histórico local de mensagens no MongoDB
- Simulador temporário de múltiplos usuários e eventos do webhook
- Clientes criados automaticamente a partir de mensagens recebidas
- Lista de telefones e identificadores extensíveis por cliente
- Histórico de conversa por cliente em modo somente leitura

Ainda não existem APIs ou coleções para agenda e acompanhamentos.

## Páginas do MVP

### 1. Visão geral

Resumo operacional obtido do banco: atendimentos de hoje, agendamentos
aguardando confirmação e acompanhamentos pendentes. Só deve exibir métricas
quando houver dados persistidos.

### 2. Agenda

Lista diária ou semanal de horários. Deve permitir criar, confirmar,
reagendar e cancelar um agendamento. O calendário completo pode esperar; uma
lista por data é suficiente para a primeira versão.

### 3. Clientes

Cadastro mínimo com nome, telefone, observações e consentimento para contato.
A página de cada cliente reúne agendamentos e acompanhamentos, evitando uma
caixa de entrada genérica no MVP.

O primeiro recorte já cria o cliente ao receber uma mensagem, mantém telefones
como lista e identificadores extensíveis. Um telefone desconhecido cria um
novo cliente; associação ou mesclagem entre números será uma ação explícita
em uma etapa futura.

### 4. Acompanhamentos

Fila de retornos com cliente, motivo, data prevista e estado. A IA pode sugerir
a mensagem, mas o envio deve começar com aprovação humana até o comportamento
ser validado.

### Conta

Continua restrita aos dados reais da sessão. Configurações editáveis só devem
aparecer quando houver API e persistência correspondentes.

## WhatsApp

A configuração oficial fica no servidor por variáveis de ambiente. Durante o
desenvolvimento, uma página temporária simula diferentes usuários enviando
payloads no formato da Meta para o mesmo processador usado pelo webhook.

A Cloud API não permite importar conversas anteriores à integração. O
histórico começa com o primeiro envio feito pela Oria ou evento recebido pelo
webhook.

Fluxo mínimo:

1. Receber uma mensagem por webhook.
2. Identificar ou criar o cliente pelo telefone.
3. Detectar intenção de agendamento ou acompanhamento.
4. Consultar disponibilidade e propor horários.
5. Persistir a escolha antes de confirmar ao cliente.
6. Registrar todas as mensagens e ações para auditoria.

## Dados mínimos

- `crm_customers`: nome, lista de telefones, identificadores e datas de interação
- `appointments`: cliente, início, duração, estado e origem
- `followUps`: cliente, data prevista, motivo, estado e mensagem sugerida
- `messages`: cliente, direção, conteúdo, identificador do provedor e data

## Ordem de implementação

1. Criar clientes e agenda com operações no servidor e MongoDB.
2. Implementar a tela Agenda e confirmar persistência ponta a ponta.
3. Criar a fila de acompanhamentos com envio manual.
4. Integrar o webhook e o envio do WhatsApp.
5. Adicionar sugestões de mensagem com IA e aprovação humana.
6. Alimentar a visão geral apenas com dados reais.

## Fora do MVP

- PIX e outros pagamentos
- Construtor visual de fluxos
- Múltiplos canais e múltiplos modelos de IA
- Relatórios avançados, cobrança e planos
- Automação sem supervisão humana
