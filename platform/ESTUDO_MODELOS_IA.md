# Estudo de modelos de IA para a pipeline da Oria

**Data de referencia:** 1 de setembro de 2026  
**Escopo:** modelos de texto capazes de executar a pipeline atual de atendimento, triagem e agendamento. Precos em USD, sem impostos.  
**Aviso:** este documento e uma analise tecnica e financeira, nao um parecer juridico sobre LGPD, HIPAA ou normas de saude.

## Resumo executivo

1. **Baseline recomendado para producao:** manter o `gpt-5.4-mini` no Azure OpenAI. Ele ja atende ao contrato de saida estruturada usado pelo sistema e evita introduzir uma migracao de modelo e de provedor ao mesmo tempo. No cenario ficticio deste estudo, o custo estimado e **US$ 912/mes**.
2. **Primeiro passo de portabilidade:** adotar o **Vercel AI SDK apenas como biblioteca**, inicialmente ainda chamando o Azure diretamente. Isso cria uma interface comum para modelos, ferramentas, saidas estruturadas e telemetria sem colocar a Vercel no caminho dos dados.
3. **Alternativas prioritarias para benchmark:** `claude-sonnet-4.6`, `gemini-3-flash`, `gemini-3.1-pro`, `amazon-nova-pro` e `mistral-medium-3.5`. Modelos muito baratos, como Mistral Small, Grok Fast, DeepSeek e Llama hospedado por terceiros, so devem assumir a decisao principal depois de passarem por testes de seguranca e confiabilidade da Oria.
4. **Vercel AI Gateway e tecnicamente atraente, mas nao deve ser habilitado agora para dados de pacientes sob os termos padrao.** O DPA publico da Vercel proibe dados sensiveis ou categorias especiais em Customer Data. Como conversas de clinicas podem conter dados de saude, e necessario obter termos contratuais especificos, revisar subprocessadores e transferencias internacionais e confirmar a cobertura de LGPD. ZDR, DPA e certificacoes isoladamente nao removem essa restricao.
5. **Preco nao deve decidir a migracao.** Nesta pipeline, um modelo barato que gera JSON invalido, escolhe uma ferramenta errada ou interpreta mal uma emergencia pode custar muito mais do que os tokens economizados.

## O que a pipeline atual faz

A Oria recebe mensagens pelo WhatsApp e processa cada conversa de forma assincrona e persistente:

- aplica debounce, lease, controle de revisao e retry na fila MongoDB;
- carrega contexto da conversa, cliente, fluxo e resumo;
- executa os fluxos `initial_triage` e `schedule_appointment`;
- exige uma resposta aderente a um JSON Schema estrito;
- permite no maximo **duas chamadas ao modelo por job**;
- permite no maximo duas ferramentas, com mutacao executada por ultimo;
- consulta disponibilidade antes de agendar, alterar ou cancelar;
- exige confirmacao explicita para mutacoes de calendario;
- possui respostas fixas para falha, handoff humano e emergencia;
- persiste estado, transicoes e assistant runs antes de enviar a resposta.

Os pontos centrais estao em [processor.ts](src/lib/assistant/processor.ts), [azure-openai.ts](src/lib/assistant/azure-openai.ts), [prompt.ts](src/lib/assistant/prompt.ts), [schema.ts](src/lib/assistant/schema.ts), [catalog.ts](src/lib/assistant/flows/catalog.ts), [calendar-definitions.ts](src/lib/assistant/tools/calendar-definitions.ts) e [queue.ts](src/lib/assistant/queue.ts).

### Consequencias para a escolha do modelo

Esta nao e uma conversa de texto livre. O modelo precisa ser consistente em seis dimensoes:

1. **Saida estruturada:** produzir objetos aninhados validos e completos, nao apenas JSON sintaticamente valido.
2. **Uso de ferramentas:** selecionar a ferramenta correta e preencher argumentos sem inventar IDs, datas ou horarios.
3. **Estado e transicoes:** manter coerencia entre a mensagem, o estado do fluxo e a proxima acao.
4. **Seguranca conversacional:** reconhecer emergencia, pedido de humano, falta de informacao e tentativa de injecao de prompt.
5. **Portugues brasileiro:** compreender abreviacoes, erros de digitacao, datas ambiguas e linguagem informal de WhatsApp.
6. **Latencia e estabilidade:** responder dentro do lease da fila e apresentar baixa taxa de erro do provedor.

O limite de duas chamadas reduz custo e exposicao, mas aumenta a importancia de acertar na primeira chamada. O modelo tambem nao deve ser tratado como uma fronteira de seguranca: schema, autorizacao, confirmacao, idempotencia e regras de ferramentas precisam continuar no codigo.

## Criterios de seguranca

O modelo mais capaz nao e automaticamente a implantacao mais segura. A avaliacao deve combinar:

| Criterio | Pergunta pratica |
| --- | --- |
| Privacidade contratual | O contrato permite dados pessoais sensiveis e define controlador, operador e subprocessadores? |
| Retencao e treinamento | Prompts e respostas sao retidos? Sao usados para treinamento? Ha ZDR contratual? |
| Residencia e transferencia | E possivel escolher regiao e documentar transferencias internacionais? |
| Identidade e rede | Ha identidade gerenciada, chaves em cofre, rede privada, RBAC e logs de auditoria? |
| Confiabilidade do modelo | O modelo respeita schema, ferramentas, confirmacoes e instrucoes adversariais? |
| Operacao | Ha SLA, quotas, observabilidade, limites de gasto, versoes fixas e rollback? |

Para a Oria, os provedores de nuvem empresarial - Azure AI Foundry/OpenAI, AWS Bedrock e Google Vertex AI - tendem a oferecer a melhor combinacao de governanca, regiao, identidade e contrato. APIs diretas tambem podem ser adequadas, mas cada uma exige revisao propria. Modelos open-weight podem oferecer controle maximo quando hospedados em uma conta isolada, porem transferem para a equipe toda a responsabilidade por hardening, escalabilidade, atualizacoes, moderacao e observabilidade.

## Modelos recomendados para avaliar

Os niveis abaixo representam adequacao esperada a esta pipeline, nao um resultado de benchmark da Oria.

| Prioridade | Modelo e implantacao sugerida | Adequacao esperada | Principal ressalva |
| --- | --- | --- | --- |
| **Baseline** | `gpt-5.4-mini` no Azure OpenAI | Melhor relacao risco/custo sem mudar o contrato atual; structured outputs e tool calling fortes | Ainda faltam telemetria de tokens e testes adversariais proprios |
| **Finalista** | `claude-sonnet-4.6` via Bedrock, Vertex ou API contratada | Forte em instrucoes complexas, ferramentas e conversacao | Mais caro; adaptar e validar a semantica de saida estruturada |
| **Finalista** | `gemini-3-flash` via Vertex AI | Baixo custo e latencia, bom candidato para alto volume | Validar JSON aninhado, argumentos de ferramentas e portugues informal |
| **Finalista** | `gemini-3.1-pro` via Vertex AI | Maior capacidade para casos ambiguos e triagem complexa | Custo e latencia superiores ao Flash |
| **Finalista** | `amazon-nova-pro` via Bedrock | Boa governanca AWS e custo competitivo | Precisa provar desempenho na tarefa e equivalencia do schema |
| **Desafiante** | `mistral-medium-3.5` via Mistral ou nuvem aprovada | Modelo aberto, multilingue e voltado a tool calling sincrono | Menos evidencias locais; Enterprise API adiciona 75% ao preco de lista |
| **Desafiante economico** | `mistral-small-4` | Custo muito baixo e suporte agentico declarado | Nao usar para mutacoes antes de benchmark rigoroso |
| **Desafiante** | Cohere Command A | Bom foco empresarial, RAG e ferramentas | Custo relativamente alto e menor vantagem para o desenho atual |
| **Desafiante economico** | xAI Grok Fast | Muito barato e rapido | Governanca, residencia e comportamento precisam de revisao especifica |
| **Pesquisa controlada** | DeepSeek V3.2 | Muito barato e capaz | Nao enviar dados reais antes de aprovacao juridica, de seguranca e de hospedagem |
| **Pesquisa controlada** | Meta Llama ou outro open-weight em Azure/AWS/GCP | Controle de rede e dados quando auto-hospedado | Preco depende da infraestrutura; operacao e seguranca ficam com a equipe |

### Fornecedores que nao devem ser confundidos com modelos

- **Azure, AWS e Google Cloud** podem hospedar modelos de varios fabricantes sob controles empresariais proprios.
- **Vercel AI SDK** e uma biblioteca de aplicacao. Usado com credenciais diretas, nao precisa processar a inferencia.
- **Vercel AI Gateway** e um intermediario de rede, faturamento e roteamento. Ele passa a fazer parte do fluxo de dados e da avaliacao de risco.
- Marketplaces e agregadores podem facilitar testes, mas adicionam outro operador e nao devem receber dados reais por conveniencia.

## Estimativa mensal de tokens

O codigo atual nao persiste `usage` retornado pelo provedor. Portanto, nao existe base de producao para calcular consumo real. Este estudo usa um cenario ficticio explicito.

### Premissas do cenario base

| Variavel | Premissa |
| --- | ---: |
| Usuarios ativos | 10.000 |
| Conversas por usuario/mes | 8 |
| Conversas por mes | 80.000 |
| Chamadas ao modelo por conversa | 1,35 em media; limite tecnico de 2 |
| Tokens de entrada por conversa | 8.000, somando todas as chamadas |
| Tokens de saida por conversa | 1.200, somando todas as chamadas |
| Tokens de entrada por mes | 640 milhoes |
| Tokens de saida por mes | 96 milhoes |
| Chamadas bem-sucedidas por mes | 108.000 |

O volume de entrada inclui system prompt, schema, historico, resumo, estado e resultados de ferramentas reenviados em uma eventual segunda chamada. Nao foi aplicado desconto de cache ou batch, pois a disponibilidade e a cobranca variam por modelo e rota.

Formula:

```text
custo mensal = 640 x preco de entrada por 1M + 96 x preco de saida por 1M
```

Cada reducao de 1.000 tokens de entrada por conversa economiza 80 milhoes de tokens de entrada por mes. No `gpt-5.4-mini`, isso representa aproximadamente **US$ 60/mes** neste cenario.

## Comparacao de precos

Precos publicos de lista observados na data de referencia. Modelos, regioes, tiers, cache e contratos podem alterar os valores; confirme a calculadora do provedor antes de contratar.

| Fabricante/provedor | Modelo representativo | Entrada US$/1M | Saida US$/1M | Estimativa mensal |
| --- | --- | ---: | ---: | ---: |
| Microsoft/OpenAI | `gpt-5.4-mini` | 0,75 | 4,50 | **US$ 912** |
| OpenAI | `gpt-5.4` | 2,50 | 15,00 | US$ 3.040 |
| Anthropic | `claude-haiku-4.5` | 1,00 | 5,00 | US$ 1.120 |
| Anthropic | `claude-sonnet-4.6` | 3,00 | 15,00 | US$ 3.360 |
| Google | `gemini-3-flash` | 0,50 | 3,00 | **US$ 608** |
| Google | `gemini-3.1-pro` | 2,00 | 12,00 | US$ 2.432 |
| Amazon Bedrock | `amazon-nova-pro` | 0,80 | 3,20 | **US$ 819,20** |
| Mistral | `mistral-small-4` | 0,15 | 0,60 | **US$ 153,60** |
| Mistral | `mistral-large-3` | 0,50 | 1,50 | US$ 464 |
| Mistral | `mistral-medium-3.5` | 1,50 | 7,50 | US$ 1.680 |
| Cohere | Command A | 2,50 | 10,00 | US$ 2.560 |
| xAI | Grok Fast, preco de referencia | 0,20 | 0,50 | **US$ 176** |
| DeepSeek | V3.2, cache miss | 0,28 | 0,42 | **US$ 219,52** |
| Meta/open-weight | Llama auto-hospedado | N/A | N/A | Depende de GPU, escala e operacao |

Os numeros em negrito sao baratos, nao necessariamente recomendados. O custo real tambem deve incluir retries, falhas, tokens de raciocinio faturados, cache, rede, observabilidade, suporte empresarial e pessoal de operacao.

### Sensibilidade por escala

Mantendo o mesmo perfil de conversa, o custo cresce aproximadamente de forma linear:

| Usuarios ativos | Conversas/mes | `gpt-5.4-mini` | `gemini-3-flash` | `claude-sonnet-4.6` |
| ---: | ---: | ---: | ---: | ---: |
| 1.000 | 8.000 | US$ 91,20 | US$ 60,80 | US$ 336 |
| 10.000 | 80.000 | US$ 912 | US$ 608 | US$ 3.360 |
| 100.000 | 800.000 | US$ 9.120 | US$ 6.080 | US$ 33.600 |

## Vercel AI SDK e AI Gateway

### Opcao A - AI SDK com provedores diretos

Esta e a opcao recomendada para a primeira etapa. O AI SDK oferece uma API comum para geracao, structured output, ferramentas e usage, enquanto as chamadas podem continuar indo diretamente ao Azure. Depois, adaptadores de Anthropic, Google, Bedrock ou Mistral podem ser testados sem reescrever o processor.

Vantagens:

- reduz acoplamento ao SDK `openai` e ao formato de um unico provedor;
- permite trocar o modelo por configuracao e manter tipos comuns;
- nao adiciona, por si so, outro subprocessador de inferencia;
- facilita testes A/B, shadow traffic sem dados sensiveis e telemetria uniforme.

Cuidados:

- uma interface comum nao torna modelos semanticamente equivalentes;
- schemas, tool calls, tokens e erros precisam de uma camada normalizada propria;
- capacidades especificas do Azure nao devem vazar para o processor;
- o modelo e o deployment devem ser fixados por versao, com rollback conhecido.

### Opcao B - Vercel AI Gateway

O Gateway oferece uma chave para centenas de modelos, BYOK, observabilidade, budgets, retries, load balancing, fallback e preco de tokens sem markup. Isso simplifica bastante a troca operacional.

Para este sistema, a configuracao minima seria:

1. plano Pro ou Enterprise e revisao contratual para permitir os dados tratados;
2. DPA/termos adequados a LGPD e, quando aplicavel, BAA ou documento equivalente;
3. ZDR habilitado em todas as requisicoes;
4. allowlist de **modelos e provedores**, inicialmente apenas rotas juridica e tecnicamente aprovadas;
5. filtro `only` por requisicao como defesa adicional;
6. BYOK marcado como ZDR apenas quando o contrato direto realmente garantir ZDR;
7. nenhum fallback para modelo ou provedor nao avaliado;
8. traces sem prompt, resposta, telefone, nome, dados clinicos ou argumentos sensiveis;
9. hard budget, alertas e limite de taxa;
10. falha fechada: se nao houver rota aprovada, handoff seguro em vez de rota livre.

**Ponto bloqueador atual:** o DPA publico da Vercel afirma que clientes nao devem incluir dados sensiveis ou categorias especiais em Customer Data. Dados de saude sao dados pessoais sensiveis na LGPD. Antes de usar o Gateway com conversas reais, essa proibicao precisa ser resolvida por escrito com a Vercel. O add-on HIPAA BAA listado no plano Pro custa US$ 350/mes, mas HIPAA nao substitui LGPD nem prova, sozinho, que o Gateway e todos os provedores roteados estao cobertos.

### Custo adicional do Gateway no cenario base

A Vercel informa que nao adiciona markup ao preco dos tokens. Com 108.000 chamadas bem-sucedidas por mes:

| Item | Calculo | Custo mensal |
| --- | ---: | ---: |
| Pro, 1 developer seat | valor de lista | US$ 20,00 |
| ZDR por requisicao | sem adicional | US$ 0,00 |
| Filtro `only` por requisicao | sem adicional | US$ 0,00 |
| ZDR team-wide | 108 x US$ 0,10 | US$ 10,80 |
| Provider allowlist team-wide | 108 x US$ 0,10 | US$ 10,80 |
| **Guard rails team-wide + Pro** |  | **US$ 41,60** |
| HIPAA BAA, se aplicavel | add-on publico Pro | US$ 350,00 |

Assim, `gpt-5.4-mini` via Gateway com controles team-wide seria aproximadamente **US$ 953,60/mes**, ou **US$ 1.303,60/mes** com o add-on HIPAA BAA, antes de impostos e outros custos Vercel. Se o plano Pro ja for pago pela aplicacao, o custo incremental dos dois controles team-wide seria US$ 21,60. Preco Enterprise e contratual.

## Lacunas atuais antes de comparar em producao

1. **Nao ha telemetria de tokens.** Persistir modelo, deployment, input, cached input, output, reasoning tokens, latencia, status e numero de chamadas, sem salvar prompts adicionais.
2. **Nao ha suite de avaliacao versionada.** O schema valida formato, mas nao prova que a decisao e clinica ou operacionalmente correta.
3. **Nao ha criterio de promocao de modelo.** Definir limites mensuraveis para JSON valido, ferramenta correta, argumentos corretos, falso negativo de emergencia, handoff, latencia e custo.
4. **Nao ha politica formal de dados enviados ao LLM.** Minimizar historico, remover identificadores desnecessarios e definir retencao e exclusao.
5. **Nao ha estrategia documentada de versao/rollback.** Evitar alias `latest` em producao quando o provedor permitir uma versao fixa.

## Plano recomendado de decisao

### Fase 1 - Instrumentar o baseline

- registrar usage e metricas por chamada;
- medir por pelo menos duas a quatro semanas;
- montar um conjunto anonimizado de 300 a 1.000 conversas e casos sinteticos;
- incluir casos de emergencia, prompt injection, cancelamento, conflito de agenda, datas ambiguas e erros de WhatsApp.

### Fase 2 - Introduzir portabilidade sem trocar o provedor

- criar uma interface interna `AssistantModelProvider`;
- migrar a implementacao Azure para o AI SDK;
- manter o mesmo schema e o mesmo `gpt-5.4-mini`;
- executar testes de regressao e comparar output/usage com o adapter atual.

### Fase 3 - Benchmark offline

Testar os finalistas com temperatura e limites equivalentes. Um modelo so avanca se atender, no minimo:

- 99,9% de respostas parseaveis sem reparo;
- 99,5% de ferramenta e argumentos corretos nos casos elegiveis;
- 100% de mutacoes bloqueadas sem confirmacao;
- nenhum falso negativo no conjunto critico de emergencia;
- nenhuma obediencia a instrucao de usuario que tente alterar policy, schema ou ferramentas;
- qualidade em portugues aprovada por revisao humana;
- p95 de latencia e taxa de erro dentro do SLO;
- custo total, incluindo retry, menor ou justificado por qualidade superior.

### Fase 4 - Canary controlado

- iniciar com 1% de trafego nao critico;
- manter mutacoes no baseline ou exigir dupla validacao durante o piloto;
- promover gradualmente com rollback automatico por erro de schema, ferramenta ou provedor;
- nunca usar fallback para um modelo que nao passou pela mesma suite.

## Recomendacao final

Para a versao atual da Oria, a ordem mais segura e:

1. **Azure OpenAI + `gpt-5.4-mini` em producao**, com telemetria e avaliacao adicionadas.
2. **Vercel AI SDK como camada de abstracao**, ainda com conexao direta ao Azure.
3. **Benchmark de Gemini 3 Flash, Claude Sonnet 4.6, Gemini 3.1 Pro, Nova Pro e Mistral Medium 3.5**.
4. **AI Gateway apenas depois de aprovacao contratual para dados sensiveis**, usando ZDR, allowlists, rotas restritas e logs minimizados.
5. **Modelos economicos e open-weight como desafiantes**, nao como substitutos automaticos do modelo principal.

Essa sequencia captura a facilidade de troca de modelos da Vercel sem transformar portabilidade em perda de governanca.

## Fontes oficiais

- [Azure OpenAI Service pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [Anthropic pricing](https://www.anthropic.com/pricing)
- [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- [Mistral API pricing](https://mistral.ai/pricing/api/)
- [Cohere pricing](https://cohere.com/pricing)
- [xAI models and pricing](https://docs.x.ai/docs/models)
- [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)
- [Vercel Zero Data Retention](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)
- [Vercel provider allowlist](https://vercel.com/docs/ai-gateway/security-and-compliance/provider-allowlist)
- [Vercel pricing and compliance](https://vercel.com/pricing)
- [Vercel Data Processing Addendum](https://vercel.com/legal/dpa)

Precos e politicas mudam com frequencia. Registre a data, a regiao, a versao do modelo e os termos contratuais usados em cada decisao de compra.