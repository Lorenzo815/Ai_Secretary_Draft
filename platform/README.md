# Oria Platform

Aplicação Next.js da Oria para atendimento administrativo pelo WhatsApp, CRM,
agenda, pagamentos e automação com IA.

## Desenvolvimento

Configure as variáveis de ambiente do MongoDB, NextAuth, WhatsApp, Azure
OpenAI, criptografia de PII e worker. Depois execute:

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

Webhooks devem apontar para `/api/webhooks/whatsapp`. O worker chama
`POST /api/internal/assistant/process` com
`Authorization: Bearer ASSISTANT_WORKER_SECRET`. Em ambientes serverless, use
um agendador externo para invocar a rota ou hospede o worker em um processo
Node contínuo.

Tokens e chaves permanecem em variáveis somente de servidor; nunca use o
prefixo `NEXT_PUBLIC_*` para segredos.

## Verificação

```bash
npm test
npm run lint
npm exec tsc -- --noEmit
npm run build
```