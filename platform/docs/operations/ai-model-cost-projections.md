# Analise de compra de modelos de IA: Standard e Flex

## Objetivo

Comparar custo, capacidade esperada e adequacao operacional dos modelos nas
modalidades Standard e Flex da API direta da OpenAI. Esta e uma projecao de
inferencia de texto; nao inclui WhatsApp, hospedagem, banco de dados, impostos
ou outros servicos da aplicacao.

## Baseline observado

A referencia e uma conversa real de agendamento que produziu 43 chamadas de
modelo:

| Metrica | Tokens |
| --- | ---: |
| Entrada total | 254.564 |
| Entrada em cache | 175.232 |
| Entrada nova | 79.332 |
| Saida | 7.906 |
| Taxa de cache | 68,8% |

A entrada nova e calculada sem contar novamente os tokens em cache:

```text
entrada nova = 254.564 - 175.232 = 79.332 tokens
```

## Premissas

- Modalidades de compra analisadas: Standard e Flex na API direta da OpenAI.
- Flex nao esta documentado como modalidade do deployment Azure usado
  atualmente pelo projeto; sua adocao exige integracao com a OpenAI direta.
- GPT-5.6 usa short context e GPT-5.4 usa contexto inferior a 272 mil tokens.
- Semana operacional: 5 dias.
- Mes operacional: 22 dias uteis.
- Cambio de referencia: US$ 1 = R$ 5,50.
- Complexidade 0,5x: metade dos tokens observados.
- Complexidade 1x: mesmo consumo da conversa observada.
- Complexidade 2x: dobro dos tokens observados.
- A quantidade de chamadas nao e tarifada diretamente; o custo depende dos
  tokens processados.
- A amostra nao informou cache writes. As projecoes nao incluem essa cobranca;
  ela deve ser medida em um piloto, especialmente na familia GPT-5.6.

## Modalidades de processamento

Standard e a modalidade padrao da API direta da OpenAI e serve como referencia
de velocidade nesta analise. Em 03/09/2026, todos os modelos comparados tambem
aparecem na tabela oficial de Flex. Para usar Flex, a requisicao deve enviar
`service_tier: "flex"`. Isso exige integracao direta com a OpenAI; nao deve ser
tratado apenas como uma configuracao do deployment Azure atual.

Flex usa precos equivalentes ao Batch, mas continua aceitando requisicoes pela
Responses API e Chat Completions. O desconto existe em troca de menor
prioridade de processamento.

## Tarifas Standard e Flex

Valores em dolares por 1 milhao de tokens, para short context:

| Modelo | Standard entrada/cache/saida | Flex entrada/cache/saida |
| --- | ---: | ---: |
| GPT-5.6 Luna | US$ 0,20 / US$ 0,02 / US$ 1,20 | US$ 0,10 / US$ 0,01 / US$ 0,60 |
| GPT-5.4 nano | US$ 0,20 / US$ 0,02 / US$ 1,25 | US$ 0,10 / US$ 0,01 / US$ 0,625 |
| GPT-5.4 mini | US$ 0,75 / US$ 0,075 / US$ 4,50 | US$ 0,375 / US$ 0,0375 / US$ 2,25 |
| GPT-5.6 Terra | US$ 2,00 / US$ 0,20 / US$ 12,00 | US$ 1,00 / US$ 0,10 / US$ 6,00 |
| GPT-5.4 | US$ 2,50 / US$ 0,25 / US$ 15,00 | US$ 1,25 / US$ 0,13 / US$ 7,50 |
| GPT-5.6 Sol | US$ 4,00 / US$ 0,40 / US$ 20,00 | US$ 2,00 / US$ 0,20 / US$ 10,00 |

Cache writes da familia GPT-5.6 custam, respectivamente, 125% da tarifa de
entrada nova em cada modalidade. As projecoes nao os incluem porque a amostra
nao informou essa metrica.

Fonte: [OpenAI Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
e [tabela de precos da OpenAI](https://developers.openai.com/api/docs/pricing).

## Custo por paciente

| Modelo | Standard 1x | Flex 1x | Economia Flex | Flex 1x em reais |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | US$ 0,0289 | US$ 0,0144 | 50% | R$ 0,08 |
| GPT-5.4 nano | US$ 0,0293 | US$ 0,0146 | 50% | R$ 0,08 |
| GPT-5.4 mini | US$ 0,1082 | US$ 0,0541 | 50% | R$ 0,30 |
| GPT-5.6 Terra | US$ 0,2886 | US$ 0,1443 | 50% | R$ 0,79 |
| GPT-5.4 | US$ 0,3607 | US$ 0,1812 | 49,8% | R$ 1,00 |
| GPT-5.6 Sol | US$ 0,5455 | US$ 0,2728 | 50% | R$ 1,50 |

Os valores GPT-5.6 acima nao incluem cache writes. Se todos os 79.332 tokens
de entrada nova da amostra tambem fossem cobrados como cache write, o custo 1x
subiria aproximadamente para US$ 0,0243 no Luna, US$ 0,2435 no Terra e
US$ 0,4711 no Sol.

## Capacidade para o fluxo da clinica

O fluxo exige mais do que responder texto: o modelo precisa obedecer ao JSON
Schema estrito, selecionar ferramentas, preservar IDs retornados, respeitar
confirmacao do cliente e coordenar cadastro, pagamento e agenda em varias
iteracoes. Todos os modelos abaixo suportam Structured Outputs, function
calling, reasoning e prompt caching, mas somente o GPT-5.4 foi validado nesta
aplicacao.

| Modelo | Posicionamento oficial | Confianca para o agente principal | Uso recomendado |
| --- | --- | --- | --- |
| GPT-5.6 Sol | Flagship para trabalho profissional e agentic complexo | Muito alta, ainda nao validada localmente | Maior qualidade ou fallback para casos complexos |
| GPT-5.6 Terra | Equilibrio entre inteligencia e custo; nivel intermediario da familia 5.6 | Alta, melhor candidato de compra | Primeiro challenger para substituir GPT-5.4 |
| GPT-5.4 | Flagship profissional com tool calling agentic comprovado | Alta e comprovada neste fluxo | Controle da avaliacao e opcao conservadora |
| GPT-5.4 mini | Mini mais forte da familia para coding, computer use e subagents | Media-alta, requer avaliacao | Alternativa economica para o agente principal |
| GPT-5.6 Luna | Alto volume e baixo custo; corresponde aproximadamente ao antigo nivel nano | Media, tecnicamente compativel mas sem prova no fluxo | Piloto em shadow ou tarefas de menor risco |
| GPT-5.4 nano | Classificacao, extracao, ranking e subagents simples | Baixa para coordenar todo o atendimento | Qualificacao, extracao e resumo; nao agenda/pagamento |

A geracao 5.6 tem sinais fortes para esta arquitetura: a OpenAI relata menos
round trips e melhor eficiencia em tarefas com ferramentas, e posiciona Terra
como modelo equilibrado e Luna como opcao de alto volume. Isso torna plausivel
que Terra e possivelmente Luna concluam o fluxo, mas benchmarks genericos nao
substituem um replay das conversas reais da clinica.

## Recomendacao de compra

1. Manter GPT-5.4 Standard como controle, pois o modelo ja concluiu o fluxo.
2. Avaliar GPT-5.6 Terra Standard como principal candidato de capacidade/custo.
3. Comparar Terra Flex com Terra Standard no mesmo conjunto de replays e so
  promover Flex se a latencia p95 for aceitavel no WhatsApp.
4. Avaliar GPT-5.4 mini em Standard e depois em Flex como challenger economico.
5. Testar GPT-5.6 Luna Flex em shadow antes de autorizar mutacoes reais.
6. Usar GPT-5.4 nano somente em classificacao, extracao e qualificacao.
7. Reservar GPT-5.6 Sol para casos complexos se Terra nao atingir a qualidade
  minima ou como fallback seletivo, nao como primeira escolha por custo.

Antes da compra, executar pelo menos 100 conversas anonimizadas para cada
challenger e exigir:

- 100% de respostas validas no schema estrutural.
- Nenhuma mutacao sem confirmacao e nenhum ID inventado.
- Taxa de conclusao de agendamento nao inferior ao GPT-5.4.
- Menor ou igual taxa de handoff incorreto e chamadas de ferramenta invalidas.
- Medicao de custo total, cache writes, latencia p50/p95, `429` e retries.
- Revisao humana de clareza, naturalidade, repeticao e aderencia administrativa.

## Projecao por modelo e volume

Os valores sao mensais e mantem as mesmas premissas de 5 dias por semana, 22
dias uteis por mes e cambio de R$ 5,50. A coluna em reais representa 1x. Em
cada modelo, Flex aparece imediatamente abaixo de Standard.

### GPT-5.6 Luna

#### Standard

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,32 | US$ 0,63 | US$ 1,27 | R$ 3,49 |
| 5 | 25 | 110 | US$ 1,59 | US$ 3,17 | US$ 6,35 | R$ 17,46 |
| 10 | 50 | 220 | US$ 3,17 | US$ 6,35 | US$ 12,70 | R$ 34,92 |
| 20 | 100 | 440 | US$ 6,35 | US$ 12,70 | US$ 25,40 | R$ 69,84 |
| 50 | 250 | 1.100 | US$ 15,87 | US$ 31,74 | US$ 63,49 | R$ 174,59 |
| 100 | 500 | 2.200 | US$ 31,74 | US$ 63,49 | US$ 126,98 | R$ 349,18 |

#### Flex

> **Warning - velocidade:** Flex usa menor prioridade e nao possui percentual
> oficial de aumento de latencia. Nas 43 chamadas do fluxo observado, esperas,
> retries e `429` podem se acumular. Validar latencia p50/p95 em shadow antes
> de usar Luna Flex no atendimento interativo.

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,16 | US$ 0,32 | US$ 0,63 | R$ 1,75 |
| 5 | 25 | 110 | US$ 0,79 | US$ 1,59 | US$ 3,17 | R$ 8,73 |
| 10 | 50 | 220 | US$ 1,59 | US$ 3,17 | US$ 6,35 | R$ 17,46 |
| 20 | 100 | 440 | US$ 3,17 | US$ 6,35 | US$ 12,70 | R$ 34,92 |
| 50 | 250 | 1.100 | US$ 7,94 | US$ 15,87 | US$ 31,74 | R$ 87,30 |
| 100 | 500 | 2.200 | US$ 15,87 | US$ 31,74 | US$ 63,49 | R$ 174,59 |

### GPT-5.4 nano

#### Standard

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,32 | US$ 0,64 | US$ 1,29 | R$ 3,54 |
| 5 | 25 | 110 | US$ 1,61 | US$ 3,22 | US$ 6,44 | R$ 17,70 |
| 10 | 50 | 220 | US$ 3,22 | US$ 6,44 | US$ 12,87 | R$ 35,40 |
| 20 | 100 | 440 | US$ 6,44 | US$ 12,87 | US$ 25,74 | R$ 70,79 |
| 50 | 250 | 1.100 | US$ 16,09 | US$ 32,18 | US$ 64,36 | R$ 176,98 |
| 100 | 500 | 2.200 | US$ 32,18 | US$ 64,36 | US$ 128,72 | R$ 353,97 |

#### Flex

> **Warning - velocidade:** alem da menor prioridade de Flex, o nano e
> posicionado para tarefas simples. Mesmo que a latencia seja aceitavel, nao
> deve orquestrar agenda e pagamento. Restringir a classificacao, extracao e
> qualificacao assincrona.

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,16 | US$ 0,32 | US$ 0,64 | R$ 1,77 |
| 5 | 25 | 110 | US$ 0,80 | US$ 1,61 | US$ 3,22 | R$ 8,85 |
| 10 | 50 | 220 | US$ 1,61 | US$ 3,22 | US$ 6,44 | R$ 17,70 |
| 20 | 100 | 440 | US$ 3,22 | US$ 6,44 | US$ 12,87 | R$ 35,40 |
| 50 | 250 | 1.100 | US$ 8,04 | US$ 16,09 | US$ 32,18 | R$ 88,49 |
| 100 | 500 | 2.200 | US$ 16,09 | US$ 32,18 | US$ 64,36 | R$ 176,98 |

### GPT-5.6 Terra

#### Standard

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 3,17 | US$ 6,35 | US$ 12,70 | R$ 34,92 |
| 5 | 25 | 110 | US$ 15,87 | US$ 31,74 | US$ 63,49 | R$ 174,59 |
| 10 | 50 | 220 | US$ 31,74 | US$ 63,49 | US$ 126,98 | R$ 349,18 |
| 20 | 100 | 440 | US$ 63,49 | US$ 126,98 | US$ 253,95 | R$ 698,37 |
| 50 | 250 | 1.100 | US$ 158,72 | US$ 317,44 | US$ 634,88 | R$ 1.745,92 |
| 100 | 500 | 2.200 | US$ 317,44 | US$ 634,88 | US$ 1.269,76 | R$ 3.491,85 |

#### Flex

> **Warning - velocidade:** Terra e o principal candidato de compra, mas Flex
> pode alongar cada uma das 43 chamadas e causar `429`. Aprovar para WhatsApp
> somente se o replay mantiver a qualidade do GPT-5.4 e a latencia p95 atender
> ao limite definido para a conversa.

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 1,59 | US$ 3,17 | US$ 6,35 | R$ 17,46 |
| 5 | 25 | 110 | US$ 7,94 | US$ 15,87 | US$ 31,74 | R$ 87,30 |
| 10 | 50 | 220 | US$ 15,87 | US$ 31,74 | US$ 63,49 | R$ 174,59 |
| 20 | 100 | 440 | US$ 31,74 | US$ 63,49 | US$ 126,98 | R$ 349,18 |
| 50 | 250 | 1.100 | US$ 79,36 | US$ 158,72 | US$ 317,44 | R$ 872,96 |
| 100 | 500 | 2.200 | US$ 158,72 | US$ 317,44 | US$ 634,88 | R$ 1.745,92 |

### GPT-5.6 Sol

#### Standard

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 6,00 | US$ 12,00 | US$ 24,00 | R$ 66,01 |
| 5 | 25 | 110 | US$ 30,00 | US$ 60,01 | US$ 120,02 | R$ 330,05 |
| 10 | 50 | 220 | US$ 60,01 | US$ 120,02 | US$ 240,04 | R$ 660,10 |
| 20 | 100 | 440 | US$ 120,02 | US$ 240,04 | US$ 480,08 | R$ 1.320,21 |
| 50 | 250 | 1.100 | US$ 300,05 | US$ 600,09 | US$ 1.200,19 | R$ 3.300,52 |
| 100 | 500 | 2.200 | US$ 600,09 | US$ 1.200,19 | US$ 2.400,38 | R$ 6.601,04 |

#### Flex

> **Warning - velocidade:** a maior capacidade do Sol nao elimina a menor
> prioridade da modalidade. Flex pode atrasar ou recusar uma chamada com `429`,
> acumulando espera no fluxo. Usar no caminho interativo somente apos medir
> p50/p95; para urgencia, prever retry em Standard.

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 3,00 | US$ 6,00 | US$ 12,00 | R$ 33,01 |
| 5 | 25 | 110 | US$ 15,00 | US$ 30,00 | US$ 60,01 | R$ 165,03 |
| 10 | 50 | 220 | US$ 30,00 | US$ 60,01 | US$ 120,02 | R$ 330,05 |
| 20 | 100 | 440 | US$ 60,01 | US$ 120,02 | US$ 240,04 | R$ 660,10 |
| 50 | 250 | 1.100 | US$ 150,02 | US$ 300,05 | US$ 600,09 | R$ 1.650,26 |
| 100 | 500 | 2.200 | US$ 300,05 | US$ 600,09 | US$ 1.200,19 | R$ 3.300,52 |

### GPT-5.4

#### Standard

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 3,97 | US$ 7,94 | US$ 15,87 | R$ 43,65 |
| 5 | 25 | 110 | US$ 19,84 | US$ 39,68 | US$ 79,36 | R$ 218,24 |
| 10 | 50 | 220 | US$ 39,68 | US$ 79,36 | US$ 158,72 | R$ 436,48 |
| 20 | 100 | 440 | US$ 79,36 | US$ 158,72 | US$ 317,44 | R$ 872,96 |
| 50 | 250 | 1.100 | US$ 198,40 | US$ 396,80 | US$ 793,60 | R$ 2.182,40 |
| 100 | 500 | 2.200 | US$ 396,80 | US$ 793,60 | US$ 1.587,20 | R$ 4.364,81 |

#### Flex

> **Warning - velocidade:** GPT-5.4 ja concluiu o fluxo corretamente, mas essa
> evidencia nao valida a modalidade Flex. As 43 chamadas podem acumular fila,
> timeout e retries. Medir p50/p95 e taxa de `429` antes de trocar o caminho
> Standard usado como controle.

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 1,99 | US$ 3,99 | US$ 7,97 | R$ 21,93 |
| 5 | 25 | 110 | US$ 9,97 | US$ 19,94 | US$ 39,87 | R$ 109,65 |
| 10 | 50 | 220 | US$ 19,94 | US$ 39,87 | US$ 79,75 | R$ 219,30 |
| 20 | 100 | 440 | US$ 39,87 | US$ 79,75 | US$ 159,49 | R$ 438,60 |
| 50 | 250 | 1.100 | US$ 99,68 | US$ 199,36 | US$ 398,73 | R$ 1.096,50 |
| 100 | 500 | 2.200 | US$ 199,36 | US$ 398,73 | US$ 797,46 | R$ 2.193,01 |

### GPT-5.4 mini

#### Standard

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 1,19 | US$ 2,38 | US$ 4,76 | R$ 13,09 |
| 5 | 25 | 110 | US$ 5,95 | US$ 11,90 | US$ 23,81 | R$ 65,47 |
| 10 | 50 | 220 | US$ 11,90 | US$ 23,81 | US$ 47,62 | R$ 130,94 |
| 20 | 100 | 440 | US$ 23,81 | US$ 47,62 | US$ 95,23 | R$ 261,89 |
| 50 | 250 | 1.100 | US$ 59,52 | US$ 119,04 | US$ 238,08 | R$ 654,72 |
| 100 | 500 | 2.200 | US$ 119,04 | US$ 238,08 | US$ 476,16 | R$ 1.309,44 |

#### Flex

> **Warning - velocidade:** Mini combina menor custo com capacidade promissora,
> mas ainda precisa provar qualidade e tempo de resposta. Em 43 chamadas, a
> menor prioridade de Flex pode tornar a conversa longa mesmo sem falha logica.
> Validar replay e latencia antes de permitir mutacoes reais.

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,60 | US$ 1,19 | US$ 2,38 | R$ 6,55 |
| 5 | 25 | 110 | US$ 2,98 | US$ 5,95 | US$ 11,90 | R$ 32,74 |
| 10 | 50 | 220 | US$ 5,95 | US$ 11,90 | US$ 23,81 | R$ 65,47 |
| 20 | 100 | 440 | US$ 11,90 | US$ 23,81 | US$ 47,62 | R$ 130,94 |
| 50 | 250 | 1.100 | US$ 29,76 | US$ 59,52 | US$ 119,04 | R$ 327,36 |
| 100 | 500 | 2.200 | US$ 59,52 | US$ 119,04 | US$ 238,08 | R$ 654,72 |

## Impacto na eficiencia de resposta

Flex usa o mesmo modelo e nao anuncia reducao de qualidade ou capacidade de
raciocinio. A troca ocorre na prioridade operacional:

- Respostas sao mais lentas e a latencia e menos previsivel que em modalidades
  de maior prioridade.
- O SDK oficial usa timeout padrao de 10 minutos; a documentacao sugere elevar
  para ate 15 minutos em tarefas longas.
- Pode ocorrer `429 Resource Unavailable` quando nao houver capacidade Flex. A
  requisicao recusada nao e cobrada.
- A OpenAI recomenda retry com exponential backoff para manter o menor custo,
  ou fallback para uma modalidade de maior prioridade quando concluir
  rapidamente for mais importante.
- Nao ha percentual oficial de aumento de latencia. Qualquer estimativa em
  segundos sem medicao propria seria especulativa.

Para este assistente, Flex somente deve assumir respostas interativas do
WhatsApp depois de um piloto de latencia. Uma conversa observada gerou 43
chamadas; atrasos, retries e indisponibilidade podem se acumular entre as
iteracoes. Ate essa validacao, Flex e mais previsivel para qualificacao,
resumos, reprocessamentos, avaliacoes e outras tarefas assincronas.

Na compra Flex, configurar retry com backoff para `429`, um limite de tempo
compativel com o canal e fallback operacional para atendimento humano ou
Standard. Medir latencia e disponibilidade separadamente para cada modelo,
pois preco e capacidade de raciocinio nao garantem tempo de resposta adequado.

## Leitura para planejamento

- GPT-5.6 Luna apresenta o menor custo projetado, mas nao esta comprovado como
  orquestrador principal do fluxo.
- GPT-5.6 Terra custa aproximadamente 80% do GPT-5.4 e e a primeira opcao a
  validar para compra.
- GPT-5.4 mini custa aproximadamente 30% do GPT-5.4 e oferece uma segunda
  alternativa economica para avaliacao.
- GPT-5.4 nano tem custo semelhante ao Luna, mas seu posicionamento oficial e
  mais adequado a tarefas auxiliares simples.
- GPT-5.6 Sol custa aproximadamente 50% mais que GPT-5.4 neste perfil e deve
  ser reservado para qualidade maxima ou fallback seletivo.
- O cache reduz materialmente a despesa. A projecao deve ser recalculada se a
  taxa de cache em producao se afastar dos 68,8% observados.
- Cache writes podem alterar a comparacao da familia GPT-5.6 e precisam entrar
  no calculo apos a primeira medicao real.
- Para reserva orcamentaria, o cenario 2x absorve conversas mais longas,
  repeticoes, falhas de ferramenta e reagendamentos.

## Como atualizar

1. Extraia da pagina de operacoes os tokens de entrada total, cache e saida.
2. Calcule `entrada nova = entrada total - cache`.
3. Atualize as tarifas por modelo conforme provider e regiao contratados.
4. Recalcule o custo por paciente usando a formula desta nota.
5. Substitua a amostra unica por media e percentis de pelo menos 30 dias de
   conversas reais antes de fechar o orcamento de producao.

# Apendice A: modelos alternativos via Vercel AI Gateway

## Escopo do apendice

Este apendice compara modelos de outros providers disponiveis pelo Vercel AI
Gateway. Os valores usam a modalidade normal listada pelo Gateway; nenhuma
projecao Flex foi aplicada, pois essa modalidade nao esta documentada para
esses modelos no Gateway.

O Vercel AI SDK e o AI Gateway simplificam a integracao, mas nao tornam os
modelos semanticamente equivalentes. Structured Outputs, tool use, cache,
reasoning, latencia e consumo de tokens podem variar entre providers. Todas as
projecoes abaixo mantem artificialmente a mesma amostra do GPT-5.4 para permitir
comparacao inicial:

- Entrada nova: 79.332 tokens.
- Entrada em cache: 175.232 tokens.
- Saida: 7.906 tokens.
- 43 chamadas por conversa observada.
- Cambio de referencia: US$ 1 = R$ 5,50.

Fontes consultadas em 03/09/2026: [modelos do Vercel AI Gateway](https://vercel.com/ai-gateway/models)
e [documentacao do AI Gateway](https://vercel.com/docs/ai-gateway).

## Regua de inteligencia operacional

Esta classificacao estima a capacidade de concluir o fluxo da clinica:
interpretar a conversa, obedecer ao schema, escolher ferramentas, preservar
IDs, respeitar confirmacoes e coordenar cadastro, pagamento e agenda. Ela nao
representa uma classificacao absoluta de inteligencia.

- `●` Baseline comprovado no fluxo.
- `🔻` Presumivelmente inferior ao GPT-5.4 completo para este fluxo.
- `≈` Candidato de nivel presumivelmente similar, ainda sem comprovacao local.
- `🔺` Presumivelmente superior em capacidade geral/agentic, ainda sem
  comprovacao local.

| Modelo | Nivel relativo ao GPT-5.4 completo | Fundamentacao para o fluxo |
| --- | --- | --- |
| GPT-5.6 Sol | 🔺 Presumivelmente superior | Flagship da familia 5.6 para trabalho agentic longo e complexo; maior teto de capacidade, mas ainda sem replay local. |
| GPT-5.6 Terra | ≈ Presumivelmente similar | Modelo equilibrado da familia 5.6 e principal candidato OpenAI de custo/capacidade. |
| GPT-5.4 completo | ● Baseline | Unico modelo que concluiu empiricamente o fluxo observado da clinica. |
| DeepSeek V4 Pro | ≈ Presumivelmente similar | Tier de capacidade para raciocinio complexo, planejamento e tool use; forte challenger, sem evidencia local. |
| Gemini 3 Flash | ≈ Presumivelmente similar | Posicionado para chat em tempo real e pipelines agentic com raciocinio pro-grade; requer validacao do schema. |
| Grok 4.1 Fast Reasoning | ≈ Presumivelmente similar | Projetado para decisoes agentic de maior risco com raciocinio, mas pode gastar mais tokens e ainda nao foi validado. |
| GPT-5.4 mini | 🔻 Presumivelmente inferior | Variante compacta e economica; pode concluir o fluxo, mas tem menor teto que o GPT-5.4 completo. |
| GPT-5.6 Luna | 🔻 Presumivelmente inferior | Tier de alto volume e menor custo da familia 5.6; compatibilidade tecnica nao prova orquestracao confiavel. |
| DeepSeek V3.2 | 🔻 Presumivelmente inferior | Suporta reasoning e tool use combinados, mas e uma geracao anterior e mais economica que o V4 Pro. |
| MiniMax M2.5 | 🔻 Presumivelmente inferior | Forte em planejamento e agentes de software, mas sem evidencia equivalente para atendimento clinico e mutacoes administrativas. |
| DeepSeek V4 Flash | 🔻 Presumivelmente inferior | Otimizado para instrucao curta, classificacao e roteamento; nao e o tier indicado para orquestracao complexa. |
| GPT-5.4 nano | 🔻 Presumivelmente inferior | Posicionado para classificacao, extracao, ranking e subagentes simples, nao para o fluxo completo. |

Nenhum simbolo substitui o teste. Um modelo `≈` somente deve ser promovido se
atingir nao inferioridade contra o GPT-5.4 completo em conclusao do fluxo,
schema valido, IDs corretos, confirmacao antes de mutacoes, handoff, latencia e
custo total. O GPT-5.6 Sol, embora marcado `🔺`, tambem precisa desse replay.

## Tarifas e custo por conversa

Valores em dolares por 1 milhao de tokens conforme o menor preco listado pelo
Gateway na data da consulta. O custo real depende do provider selecionado e do
cache efetivamente reconhecido.

| Modelo | Entrada | Cache | Saida | Conversa 1x | 1x em reais |
| --- | ---: | ---: | ---: | ---: | ---: |
| DeepSeek V4 Flash | US$ 0,09 | US$ 0,01 | US$ 0,18 | US$ 0,0103 | R$ 0,06 |
| Grok 4.1 Fast Reasoning | US$ 0,20 | US$ 0,05 | US$ 0,50 | US$ 0,0286 | R$ 0,16 |
| DeepSeek V3.2 | US$ 0,28 | US$ 0,03 | US$ 0,42 | US$ 0,0308 | R$ 0,17 |
| MiniMax M2.5 | US$ 0,27 | US$ 0,03 | US$ 0,95 | US$ 0,0342 | R$ 0,19 |
| DeepSeek V4 Pro | US$ 0,66 | US$ 0,02 | US$ 1,98 | US$ 0,0715 | R$ 0,39 |
| Gemini 3 Flash | US$ 0,50 | US$ 0,05 | US$ 3,00 | US$ 0,0721 | R$ 0,40 |

Esses custos nao devem ser tratados como previsao final. Um challenger pode
usar mais ou menos iteracoes, reasoning tokens e tokens de saida que o GPT-5.4.
O cache de 68,8% observado tambem pode nao se repetir em outro provider.

## Projecoes por modelo alternativo

### DeepSeek V4 Pro

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,79 | US$ 1,57 | US$ 3,15 | R$ 8,65 |
| 5 | 25 | 110 | US$ 3,93 | US$ 7,87 | US$ 15,73 | R$ 43,27 |
| 10 | 50 | 220 | US$ 7,87 | US$ 15,73 | US$ 31,47 | R$ 86,54 |
| 20 | 100 | 440 | US$ 15,73 | US$ 31,47 | US$ 62,94 | R$ 173,07 |
| 50 | 250 | 1.100 | US$ 39,33 | US$ 78,67 | US$ 157,34 | R$ 432,68 |
| 100 | 500 | 2.200 | US$ 78,67 | US$ 157,34 | US$ 314,68 | R$ 865,36 |

### Gemini 3 Flash

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,79 | US$ 1,59 | US$ 3,17 | R$ 8,73 |
| 5 | 25 | 110 | US$ 3,97 | US$ 7,94 | US$ 15,87 | R$ 43,65 |
| 10 | 50 | 220 | US$ 7,94 | US$ 15,87 | US$ 31,74 | R$ 87,30 |
| 20 | 100 | 440 | US$ 15,87 | US$ 31,74 | US$ 63,49 | R$ 174,59 |
| 50 | 250 | 1.100 | US$ 39,68 | US$ 79,36 | US$ 158,72 | R$ 436,48 |
| 100 | 500 | 2.200 | US$ 79,36 | US$ 158,72 | US$ 317,44 | R$ 872,96 |

### MiniMax M2.5

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,38 | US$ 0,75 | US$ 1,50 | R$ 4,14 |
| 5 | 25 | 110 | US$ 1,88 | US$ 3,76 | US$ 7,52 | R$ 20,68 |
| 10 | 50 | 220 | US$ 3,76 | US$ 7,52 | US$ 15,04 | R$ 41,37 |
| 20 | 100 | 440 | US$ 7,52 | US$ 15,04 | US$ 30,08 | R$ 82,73 |
| 50 | 250 | 1.100 | US$ 18,80 | US$ 37,61 | US$ 75,21 | R$ 206,83 |
| 100 | 500 | 2.200 | US$ 37,61 | US$ 75,21 | US$ 150,42 | R$ 413,67 |

### DeepSeek V3.2

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,34 | US$ 0,68 | US$ 1,35 | R$ 3,73 |
| 5 | 25 | 110 | US$ 1,69 | US$ 3,39 | US$ 6,77 | R$ 18,63 |
| 10 | 50 | 220 | US$ 3,39 | US$ 6,77 | US$ 13,55 | R$ 37,26 |
| 20 | 100 | 440 | US$ 6,77 | US$ 13,55 | US$ 27,10 | R$ 74,51 |
| 50 | 250 | 1.100 | US$ 16,93 | US$ 33,87 | US$ 67,74 | R$ 186,28 |
| 100 | 500 | 2.200 | US$ 33,87 | US$ 67,74 | US$ 135,48 | R$ 372,56 |

### Grok 4.1 Fast Reasoning

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,31 | US$ 0,63 | US$ 1,26 | R$ 3,46 |
| 5 | 25 | 110 | US$ 1,57 | US$ 3,14 | US$ 6,29 | R$ 17,29 |
| 10 | 50 | 220 | US$ 3,14 | US$ 6,29 | US$ 12,58 | R$ 34,58 |
| 20 | 100 | 440 | US$ 6,29 | US$ 12,58 | US$ 25,15 | R$ 69,17 |
| 50 | 250 | 1.100 | US$ 15,72 | US$ 31,44 | US$ 62,88 | R$ 172,92 |
| 100 | 500 | 2.200 | US$ 31,44 | US$ 62,88 | US$ 125,76 | R$ 345,83 |

### DeepSeek V4 Flash

| Pacientes/dia | Pacientes/semana | Pacientes/mes | 0,5x | 1x | 2x | 1x em reais |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 22 | US$ 0,11 | US$ 0,23 | US$ 0,45 | R$ 1,25 |
| 5 | 25 | 110 | US$ 0,57 | US$ 1,13 | US$ 2,27 | R$ 6,24 |
| 10 | 50 | 220 | US$ 1,13 | US$ 2,27 | US$ 4,54 | R$ 12,48 |
| 20 | 100 | 440 | US$ 2,27 | US$ 4,54 | US$ 9,08 | R$ 24,96 |
| 50 | 250 | 1.100 | US$ 5,67 | US$ 11,35 | US$ 22,69 | R$ 62,41 |
| 100 | 500 | 2.200 | US$ 11,35 | US$ 22,69 | US$ 45,39 | R$ 124,81 |

## Recomendacao do apendice

1. Comparar primeiro DeepSeek V4 Pro e Gemini 3 Flash contra GPT-5.4 completo.
2. Incluir Grok 4.1 Fast Reasoning como challenger de custo/latencia.
3. Avaliar DeepSeek V3.2 e MiniMax M2.5 em shadow antes de mutacoes reais.
4. Usar DeepSeek V4 Flash apenas em classificacao, extracao e roteamento.
5. Fixar modelo e provider durante cada replay; nao usar fallback automatico
  entre modelos diferentes em chamadas que possam gerar mutacoes.
6. Exigir provider com zero data retention, treinamento desabilitado e revisao
  contratual de LGPD antes de enviar dados da clinica.