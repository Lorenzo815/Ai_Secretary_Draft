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

```bash
npm test
npm run lint
npm exec tsc -- --noEmit
npm run build
```