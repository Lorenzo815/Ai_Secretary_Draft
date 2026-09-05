# Analise de uso de tokens e oportunidades de otimizacao

## Resumo executivo

Snapshot read-only do MongoDB `ai_secretary`, gerado em 04/09/2026. A janela
retida vai de 03/09/2026 04:13 UTC a 03/09/2026 20:57 UTC.

- 281 chamadas tinham telemetria completa: 274 do agente de atendimento e 7
  de qualificacao de lead.
- O agente processou 1.829.621 tokens em 158 execucoes, ou 6.677 tokens por
  chamada e 11.580 por execucao, em media.
- 65,2% da entrada do agente foi atendida por cache. Pelas tarifas Standard do
  GPT-5.4 usadas na projecao de custos, isso reduziu o custo observado do agente
  de aproximadamente US$ 5,06 para US$ 2,43, uma economia estimada de 51,9%.
- 22 execucoes com tres ou mais chamadas, apenas 13,9% das execucoes,
  concentraram 557.329 tokens, ou 30,5% do total do agente.
- Chamadas a partir da terceira iteracao consumiram 249.459 tokens, 13,6% do
  total, e cerca de US$ 0,30. Esse e o melhor grupo para procurar round trips
  evitaveis, sem presumir que toda iteracao extra seja desperdicio.
- No mesmo usuario anonimizado, a revisao 33 teve 33,9% mais entrada por chamada
  e 11,4 pontos percentuais menos cache que a revisao 25. A amostra da revisao
  33 tem apenas 12 chamadas e ocorreu mais tarde na mesma conversa; portanto,
  o resultado e um alerta, nao uma conclusao causal.
- A configuracao ativa e a revisao 34, atualizada em 03/09/2026 20:59 UTC. Nao
  havia chamada dessa revisao na janela, logo as mudancas mais recentes ainda
  nao podem ser avaliadas com dados reais.

## Escopo e metodologia

Foram consultadas somente as colecoes `ai_task_calls`, `assistant_runs` e
`assistant_agent_config`. Nenhuma mensagem, prompt bruto, dado cadastral ou
identificador de cliente foi exportado para este documento.

As 274 chamadas `customer_agent` foram associadas a uma execucao pelo mesmo
cliente, revisao de configuracao e intervalo entre `startedAt` e `completedAt`.
Todas foram associadas; nenhuma ficou sem execucao correspondente. Os cinco
clientes observados aparecem apenas como U1 a U5, ordenados por volume.

Definicoes:

```text
entrada nova = inputTokens - cachedInputTokens
taxa de cache = cachedInputTokens / inputTokens
custo GPT-5.4 Standard =
  entrada nova * US$ 2,50/M
  + entrada em cache * US$ 0,25/M
  + saida * US$ 15,00/M
```

Os precos e o cambio de referencia de US$ 1 = R$ 5,50 seguem
`ai-model-cost-projections.md`. Os valores sao estimativas da API direta da
OpenAI e nao representam necessariamente a fatura do deployment Azure atual.

## Uso por chamada

| Tarefa | Chamadas | Entrada media | Entrada p50 | Entrada p95 | Saida media | Cache | Latencia p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Agente de atendimento | 274 | 6.536 | 6.717 | 8.614 | 142 | 65,2% | 3,85 s |
| Qualificacao de lead | 7 | 1.686 | 1.428 | 2.204 | 1.093 | 10,8% | 17,30 s |
| Geral | 281 | 6.415 | 6.681 | 8.508 | 165 | 64,9% | 3,86 s |

O agente usou 1.790.775 tokens de entrada, dos quais 1.167.872 vieram de
cache, e 38.846 tokens de saida. A entrada representa 97,9% dos tokens, mas a
saida ainda representa cerca de 24% do custo estimado porque sua tarifa e seis
vezes maior que a entrada nova.

A qualificacao tem o perfil oposto: sua saida media e 7,7 vezes a do agente e
sua latencia mediana e 4,5 vezes maior. Apesar do volume pequeno, o schema ou a
resposta dessa tarefa merece uma analise separada.

## Uso por execucao

| Metrica | Resultado |
| --- | ---: |
| Execucoes | 158 |
| Chamadas por execucao, media | 1,73 |
| Chamadas por execucao, p50 / p95 | 2 / 3 |
| Tokens por execucao, media | 11.580 |
| Tokens por execucao, p50 / p95 | 10.006 / 25.979 |
| Maior execucao | 43.309 |
| Execucoes de ferramenta | 120 |
| Mutacoes bem-sucedidas | 54 |
| Status | 155 completed / 3 superseded |

| Chamadas na execucao | Execucoes | Tokens medios por execucao | Total aproximado |
| ---: | ---: | ---: | ---: |
| 1 | 75 | 6.719 | 503.925 |
| 2 | 61 | 12.596 | 768.356 |
| 3 | 14 | 21.924 | 306.936 |
| 4 | 6 | 28.578 | 171.468 |
| 5 | 1 | 35.616 | 35.616 |
| 6 | 1 | 43.309 | 43.309 |

Os 22 runs com tres ou mais chamadas devem ser classificados por motivo:
sequencia necessaria de ferramentas, erro corrigivel, repeticao da mesma busca,
ou chamada posterior a uma mutacao ja concluida. A finalizacao deterministica
apos `calendar.book` e `calendar.reschedule`, adicionada no codigo atual, ataca
diretamente a ultima categoria. A revisao 34 precisa de trafego para medir o
efeito.

## Uso por usuario anonimizado

| Usuario | Runs | Chamadas | Tokens/chamada | Tokens/run | Cache | Total de tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| U1 | 85 | 160 | 7.262 | 13.671 | 63,4% | 1.161.993 |
| U2 | 26 | 45 | 5.989 | 10.366 | 63,5% | 269.513 |
| U3 | 16 | 27 | 5.563 | 9.388 | 71,0% | 150.214 |
| U4 | 26 | 36 | 6.039 | 8.361 | 70,6% | 217.392 |
| U5 | 5 | 6 | 5.085 | 6.102 | 82,8% | 30.509 |

U1 responde por 63,5% dos tokens e foi o unico usuario presente em todas as
revisoes. Isso torna medias globais por revisao especialmente vulneraveis ao
tipo e ao estagio dessa unica conversa.

## Comparacao por revisao

Somente chamadas do agente:

| Revisao | Runs | Chamadas | Entrada/chamada | Entrada nova/chamada | Saida/chamada | Cache | Tokens/run |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 21 | 20 | 34 | 5.892 | 1.774 | 136 | 69,9% | 10.247 |
| 22 | 4 | 8 | 7.253 | 2.501 | 139 | 65,5% | 14.783 |
| 25 | 107 | 194 | 6.269 | 2.013 | 134 | 67,9% | 11.610 |
| 30 | 3 | 7 | 7.478 | 2.778 | 122 | 62,8% | 17.734 |
| 31 | 9 | 11 | 8.686 | 4.718 | 182 | 45,7% | 10.839 |
| 32 | 8 | 8 | 6.889 | 3.865 | 232 | 43,9% | 7.121 |
| 33 | 7 | 12 | 9.428 | 4.158 | 205 | 55,9% | 16.513 |

A revisao 32 teve uma chamada por run, mas nao executou ferramentas ou
mutacoes. Ela representa turnos simples e nao prova que a configuracao seja
mais eficiente em fluxos equivalentes.

### Comparacao controlada no mesmo usuario

| Revisao | Chamadas | Entrada/chamada | Entrada nova/chamada | Saida/chamada | Cache |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 80 | 7.041 | 2.300 | 142 | 67,3% |
| 30 | 7 | 7.478 | 2.778 | 122 | 62,8% |
| 31 | 11 | 8.686 | 4.718 | 182 | 45,7% |
| 32 | 8 | 6.889 | 3.865 | 232 | 43,9% |
| 33 | 12 | 9.428 | 4.158 | 205 | 55,9% |

Entre as revisoes 25 e 30, o texto dos campos centrais da configuracao cresceu
de 4.843 para 5.724 caracteres, ou 18,2%. Ao mesmo tempo, as ferramentas
habilitadas cairam de nove para seis. A partir da revisao 31, o limite de
iteracoes subiu de seis para oito. O crescimento da politica e do conhecimento
e consistente com parte do aumento de entrada, mas os dados nao isolam o
conteudo dinamico de `runtime`, historico, resumo e resultados de ferramentas.

## Custo observado

Para as 274 chamadas do agente GPT-5.4 Standard:

| Componente | Tokens | Custo estimado |
| --- | ---: | ---: |
| Entrada nova | 622.903 | US$ 1,5573 |
| Entrada em cache | 1.167.872 | US$ 0,2920 |
| Saida | 38.846 | US$ 0,5827 |
| **Total** | **1.829.621** | **US$ 2,4319** |

Isso equivale a aproximadamente US$ 0,0089 por chamada, US$ 0,0154 por run e
R$ 13,38 no snapshot inteiro. Sem cache, a mesma carga custaria cerca de
US$ 5,06. Cache writes nao foram informados pelo provider e nao estao incluidos.

## Oportunidades priorizadas

1. **Medir a revisao 34 antes de nova expansao de prompt.** Coletar pelo menos
   100 runs e comparar chamadas/run, tokens/run, cache e taxa de conclusao com
   a revisao 25. A revisao atual ainda tem zero chamadas observadas.
2. **Instrumentar o motivo de cada iteracao extra.** Persistir `runId`, nome da
   ferramenta, resultado `ok`, `retryable` e categoria de encerramento no trace
   da chamada. Hoje o pareamento temporal funciona, mas nao distingue custo
   necessario de repeticao evitavel.
3. **Atacar runs com tres ou mais chamadas.** Chamadas da terceira iteracao em
   diante somam 13,6% dos tokens e cerca de 12,4% do custo do agente. A meta nao
   deve ser zerar esse grupo, e sim remover chamadas posteriores a sucesso,
   buscas identicas e retries sem mudanca efetiva.
4. **Reduzir e estabilizar o prefixo nao cacheado.** Separar politica estatica,
   definicoes de ferramentas e dados dinamicos em ordem estavel; evitar hashes,
   timestamps e JSON variavel antes do conteudo reutilizavel. A queda de cache
   de 67,3% para 55,9% entre revisoes 25 e 33 no mesmo usuario merece profiling.
5. **Compactar o contexto autoritativo.** Enviar ao modelo somente campos de
   cadastro faltantes, operacoes ativas e ferramentas relevantes para o estado
   atual. Nao remover validacoes do servidor nem fatos necessarios para decisoes
   seguras.
6. **Revisar o schema de qualificacao.** A tarefa gera 1.093 tokens de saida por
   chamada e leva 17,3 s no p50. Testar um schema menor e GPT-5.4 mini em replay,
   exigindo equivalencia de classificacao antes de promover a mudanca.
7. **Criar alertas operacionais.** Sinalizar chamada acima de 9 mil tokens de
   entrada, run acima de 26 mil tokens, cache abaixo de 50%, tres ou mais
   iteracoes e qualquer telemetria ausente. Esses limites aproximam os p95
   observados e devem ser recalibrados com uma janela maior.

## Plano de medicao

Para confirmar uma otimizacao, usar um conjunto fixo de conversas anonimizadas
ou divisao A/B e registrar simultaneamente:

- conclusao correta da intencao e revisao humana da resposta;
- chamadas, entrada nova, entrada em cache e saida por run;
- ferramentas, retries, erros e mutacoes por run;
- latencia p50 e p95;
- custo por run concluido, nao apenas por chamada;
- distribuicao por complexidade: sem ferramenta, leitura, mutacao e retry.

Uma mudanca so deve ser considerada melhoria quando reduz custo ou latencia sem
piorar conclusao, seguranca de mutacao, fidelidade ao cliente ou handoff correto.

## Limitacoes

- A janela cobre menos de 17 horas, cinco usuarios e forte concentracao em U1.
- As revisoes nao foram executadas em paralelo sobre entradas equivalentes.
- A colecao `ai_task_calls` expira apos 30 dias; este relatorio nao e historico
  permanente.
- Tokens do schema, das ferramentas e de cada bloco do prompt nao sao medidos
  separadamente.
- O custo usa tabela de referencia da OpenAI direta, nao faturamento Azure.
- A revisao 34 e as correcoes mais recentes nao possuem dados no snapshot.