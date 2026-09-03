# Assistente da Oria

O atendimento usa um único agente configurável. Não há máquina de estados ou
prompts separados por fluxo. Regras de automação decidem quando executar cada
processo; a qualificação de leads continua independente e compartilha apenas a
infraestrutura de IA.

## Execução

1. Um evento de domínio é comparado às regras persistidas de automação.
2. `automation_jobs` agrega eventos por processo e cliente, aplicando debounce.
3. O worker obtém o job com lease e fixa a revisão ativa do agente.
4. O servidor monta contexto autoritativo de horário local, cliente, pagamento
   e agenda.
5. O modelo retorna exatamente `final` ou um `tool_request` por iteração.
6. O servidor autoriza e executa a ferramenta, acumulando seu resultado.
7. A resposta final é enviada somente se o job ainda for a revisão atual.

Execuções ficam em `assistant_runs` e seus passos em `assistant_run_steps`. A
configuração ativa fica em `assistant_agent_config`; seu snapshot de auditoria
remove chave e favorecido Pix.

## Limites e segurança

- Limites de iteração, ferramentas, mutações e chamadas inválidas são
  configuráveis no Agent Studio e aplicados pelo servidor.
- Cada job usa a mesma revisão e o mesmo hash de configuração até terminar.
- O modelo não autoriza ferramentas nem valida regras de agenda.
- Datas relativas usam o relógio e o fuso autoritativos da clínica.
- Propostas de agenda têm expiração e revisão; reservas revalidam todos os
  horários e aplicam rollback se uma etapa falhar.
- CPF é validado e protegido no servidor; não entra na memória do agente.
- Chave Pix e favorecido só aparecem no resultado da ferramenta de pagamento.
- Emergência e encaminhamento humano mudam o estado operacional antes do envio.

## Configuração

`/dashboard/fluxos` hospeda o Agent Studio. Alterações usam controle otimista
por revisão e substituem a configuração ativa após validação. Planos de agenda
podem ter etapas arbitrárias e restrições de ordem, intervalo e mesmo dia.

Ferramentas executáveis continuam registradas em código. O Studio escolhe
quais estão habilitadas, mas não cria capacidades novas nem contorna validação
server-side.

## Processos independentes

`customer_agent` conduz a conversa e pode usar ferramentas. `lead_qualification`
analisa o perfil em um processo separado, com prompt, limite e histórico
próprios. Ambos são acionados pela fila genérica de automação.