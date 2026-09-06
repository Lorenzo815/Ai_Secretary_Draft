import "server-only";

import type { ObjectId } from "mongodb";
import { DateTime } from "luxon";
import { generateStructuredOutput } from "../ai/structured-output";
import {
  findCustomerById,
  getCustomerProfileSnapshot,
  saveCustomerLeadQualification,
  type CustomerLeadQualification,
} from "../crm";
import { listWhatsAppMessagesForAssistant } from "../whatsapp";
import { getLeadQualificationConfiguration } from "./config";
import { LEAD_QUALIFICATION_VERSION } from "./contracts";
import { assertInsightTagEvidence } from "./evidence";
import { acquireQualificationLock } from "./lock";
import { buildQualificationSourceHash } from "./source-hash";

const CLINIC_CITY = "Ponta Grossa/PR";
const CLINIC_TIMEZONE = "America/Sao_Paulo";
export async function analyzeAndSaveCustomerLeadQualification(
  customerId: ObjectId,
  options: { force?: boolean } = {},
) {
  const customer = await findCustomerById(customerId.toString());
  if (!customer) throw new Error("Cliente não encontrado.");
  const profile = getCustomerProfileSnapshot(customer);
  const taskConfiguration = await getLeadQualificationConfiguration();
  if (!taskConfiguration.enabled) return customer.leadQualification ?? null;

  const messages = await listWhatsAppMessagesForAssistant(
    customerId,
    undefined,
    40,
  );
  const conversation = messages.slice(-20).map((message) => ({
    messageId: message._id.toString(),
    direction: message.direction,
    timestamp: message.timestamp.toISOString(),
    text: minimizeConversationText(message.body),
  }));
  const input = {
    clinicCity: CLINIC_CITY,
    customerLocation: {
      neighborhood: profile.address?.neighborhood ?? null,
      city: profile.address?.city ?? null,
      state: profile.address?.state ?? null,
    },
    ageYears: profile.birthDate ? calculateAge(profile.birthDate) : null,
    profession: profile.profession ?? null,
    conversation,
  };
  const sourceHash = buildQualificationSourceHash(input, taskConfiguration.contentHash);
  if (!options.force && customer.leadQualification?.version === LEAD_QUALIFICATION_VERSION && customer.leadQualification.sourceHash === sourceHash) {
    return customer.leadQualification;
  }

  const releaseLock = await acquireQualificationLock(customerId, sourceHash);
  try {
    const response = await generateStructuredOutput({
      taskKey: "lead_qualification",
      customerId,
      messages: [
        { role: "system", content: QUALIFICATION_POLICY },
        { role: "developer", content: taskConfiguration.prompt },
        { role: "user", content: JSON.stringify(input) },
      ],
      schemaName: "customer_lead_qualification",
      schema: QUALIFICATION_SCHEMA,
      maxCompletionTokens: taskConfiguration.maxCompletionTokens,
      trace: {
        configRevision: taskConfiguration.revision,
        configHash: taskConfiguration.contentHash,
        sourceHash,
      },
      parse: (content) => {
        const output = JSON.parse(content) as QualificationModelOutput;
        assertInsightTagEvidence(output.insightTags, conversation);
        return output;
      },
    });
    const qualification: CustomerLeadQualification = {
      version: LEAD_QUALIFICATION_VERSION,
      generatedAt: new Date(),
      model: response.model,
      sourceHash,
      profileContext: {
        ageYears: input.ageYears,
        neighborhood: input.customerLocation.neighborhood ?? "",
        city: input.customerLocation.city ?? "",
        state: input.customerLocation.state ?? "",
      },
      ...response.value,
    };
    await saveCustomerLeadQualification(customerId, qualification);
    return qualification;
  } finally {
    await releaseLock();
  }
}

function calculateAge(birthDate: string) {
  const birth = DateTime.fromISO(birthDate, { zone: CLINIC_TIMEZONE });
  return Math.floor(DateTime.now().setZone(CLINIC_TIMEZONE).diff(birth, "years").years);
}

function minimizeConversationText(value: string) {
  return value
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF REDIGIDO]")
    .replace(/\b\d{8,}\b/g, "[DADO NUMÉRICO REDIGIDO]")
    .slice(0, 1_500);
}

type QualificationModelOutput = Omit<
  CustomerLeadQualification,
  "version" | "generatedAt" | "model" | "sourceHash" | "profileContext"
>;

const QUALIFICATION_POLICY = `Você é um analista de operações comerciais de uma clínica particular.
Produza uma análise descritiva para revisão humana, nunca uma decisão de acesso, prioridade clínica, elegibilidade ou tratamento diferencial.

REGRAS:
- profileFit mede a compatibilidade comercial a partir do cadastro: completude administrativa, viabilidade logística em nível de cidade/distância até Ponta Grossa e estimativa conservadora de nível socioeconômico.
- Para estimar o componente socioeconômico de profileFit, considere a faixa salarial bruta de mercado da profissão informada e a idade do paciente. Trate ambos como sinais aproximados, nunca como comprovação de salário, renda disponível, patrimônio ou classe social real.
- A idade pode contextualizar momento de carreira e provável estabilidade econômica, mas não deve ser usada isoladamente nem receber peso desproporcional. Explique qualquer influência no rationale de profileFit.
- combinedFit parte do profileFit e incorpora somente sinais explícitos da conversa: interesse, intenção de agendar, reação declarada ao preço, perguntas, continuidade e ações realizadas.
- Se ainda não houver intenção explícita, estime combinedFit a partir do profileFit com confiança conservadora. Não use insufficient_data somente pela ausência de intenção; explique que ainda não houve sinal comportamental.
- Não use bairro como proxy socioeconômica. Cidade só pode influenciar profileFit pela logística objetiva de deslocamento.
- Os scores apoiam leitura comercial humana. Nunca determinam acesso, prioridade clínica, elegibilidade ou tratamento diferencial.
- insightTags deve resumir em até 6 etiquetas a situação comercial mais importante para leitura rápida e ajudar a explicar combinedFit. Retorne uma lista vazia quando não houver evidência explícita suficiente; não force etiquetas.
- O rótulo e a categoria de cada etiqueta são livres, curtos e reutilizáveis; escreva ambos em português natural, com espaços e acentos, nunca como identificadores snake_case. Não escolha de uma taxonomia fechada. Use tone=positive para avanço ou interesse explícito, attention para fricção ou bloqueio explícito, info para contexto útil e neutral para incerteza ou ausência de sinal.
- Cada etiqueta precisa de uma ou mais evidências. Em cada evidência, copie messageId exatamente da conversa e excerpt como trecho literal e contínuo do text dessa mesma mensagem; não parafraseie, não altere pontuação e não invente IDs. Use múltiplas evidências quando a etiqueta representar um padrão entre mensagens. Não crie etiqueta baseada apenas na ausência de uma ação ou resposta, pois isso não possui citação direta verificável.
- Não crie etiquetas sobre diagnóstico, condição de saúde, renda, patrimônio, classe social, capacidade de pagamento ou outros atributos sensíveis. Não use inferências como fatos e não duplique a mesma ideia.
- Em occupationMarketBenchmark, estime a faixa mensal bruta de mercado da profissão informada na geografia disponível. Use-a como um dos componentes de profileFit, sem tratá-la como salário individual. Use faixa ampla, confiança conservadora e ressalvas sobre senioridade, vínculo, especialidade, carga horária e fonte não verificada.
- Descreva somente uma tendência socioeconômica estimada para fins comerciais. Nunca afirme renda, patrimônio, classe social, capacidade de pagamento ou risco financeiro como fatos sobre o paciente.
- Estime distância aproximada entre a localidade informada e o centro do município de Ponta Grossa/PR. Deixe claro que a referência não é o endereço exato da clínica. Use null se não houver segurança.
- Diferencie fatos, sinais explícitos e estimativas. Não invente evidências.
- Em dropOffAnalysis, avalie por que o cliente pode ter interrompido a conversa usando somente sinais das mensagens recentes. Silêncio isolado não prova desinteresse: use likelyCause=null e confiança baixa quando não houver evidência.
- A resposta recomendada para possível abandono deve remover uma fricção concreta, facilitar o próximo passo e permanecer respeitosa, sem pressão ou urgência artificial.
- Antes de escrever recommendedResponse, examine todas as mensagens enviadas depois da última entrada do cliente. Recomende uma estratégia, argumento, pergunta e chamada para ação que ainda não tenham sido usados; apenas trocar palavras não conta como novidade.
- Para objeção de preço já respondida com características do serviço, não recomende repetir a mesma defesa. Se o objetivo do cliente ainda não estiver claro, priorize descobri-lo com uma pergunta curta de escolha; se estiver claro, relacione somente um diferencial autorizado a esse objetivo.
- Quando já houver várias tentativas sem resposta, recomende reduzir o compromisso ou encerrar com respeito, em vez de intensificar a insistência.
- Se a conversa comercial ainda não ocorreu, mantenha os sinais explícitos como unknown, sem inventar intenção; combinedFit ainda pode refletir o profileFit com baixa confiança.
- recommendedApproach deve orientar uma conversa respeitosa, sem pressão, urgência artificial ou promessa clínica.
- Escreva em português brasileiro, de forma concisa, específica e auditável.`;

const confidence = { type: "string", enum: ["high", "medium", "low"] };
const stringArray = { type: "array", maxItems: 8, items: { type: "string" } };

const QUALIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "profileFit",
    "combinedFit",
    "explicitSignals",
    "dropOffAnalysis",
    "insightTags",
    "logistics",
    "occupationMarketBenchmark",
    "strengths",
    "frictions",
    "openQuestions",
    "recommendedApproach",
    "reasoningSummary",
    "limitations",
  ],
  properties: {
    profileFit: fitScoreSchema(),
    combinedFit: fitScoreSchema(),
    explicitSignals: {
      type: "object",
      additionalProperties: false,
      required: ["schedulingIntent", "priceSentiment", "engagement", "evidence"],
      properties: {
        schedulingIntent: { type: "string", enum: ["strong", "moderate", "weak", "unknown"] },
        priceSentiment: { type: "string", enum: ["positive", "neutral", "concerned", "negative", "unknown"] },
        engagement: { type: "string", enum: ["high", "medium", "low"] },
        evidence: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["signal", "observation"],
            properties: {
              signal: { type: "string" },
              observation: { type: "string" },
            },
          },
        },
      },
    },
    dropOffAnalysis: {
      type: "object",
      additionalProperties: false,
      required: ["likelyCause", "confidence", "evidence", "recommendedResponse"],
      properties: {
        likelyCause: { type: ["string", "null"] },
        confidence,
        evidence: stringArray,
        recommendedResponse: { type: "string" },
      },
    },
    insightTags: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "category", "tone", "evidence"],
        properties: {
          label: { type: "string", maxLength: 40 },
          category: { type: "string", maxLength: 30 },
          tone: { type: "string", enum: ["positive", "attention", "info", "neutral"] },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["messageId", "excerpt"],
              properties: {
                messageId: { type: "string" },
                excerpt: { type: "string", minLength: 1, maxLength: 180 },
              },
            },
          },
        },
      },
    },
    logistics: {
      type: "object",
      additionalProperties: false,
      required: ["clinicCity", "customerCity", "customerNeighborhood", "distanceReference", "proximity", "estimatedDistanceKm", "confidence", "rationale"],
      properties: {
        clinicCity: { type: "string" },
        customerCity: { type: "string" },
        customerNeighborhood: { type: "string" },
        distanceReference: { type: "string" },
        proximity: { type: "string", enum: ["same_city", "nearby", "regional", "distant", "unknown"] },
        estimatedDistanceKm: { type: ["number", "null"], minimum: 0 },
        confidence,
        rationale: { type: "string" },
      },
    },
    occupationMarketBenchmark: {
      type: "object",
      additionalProperties: false,
      required: ["profession", "geographyBasis", "estimatedMonthlyGrossRangeBRL", "confidence", "rationale", "caveats"],
      properties: {
        profession: { type: "string" },
        geographyBasis: { type: "string" },
        estimatedMonthlyGrossRangeBRL: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["min", "max"],
              properties: {
                min: { type: "integer", minimum: 0 },
                max: { type: "integer", minimum: 0 },
              },
            },
            { type: "null" },
          ],
        },
        confidence,
        rationale: { type: "string" },
        caveats: stringArray,
      },
    },
    strengths: stringArray,
    frictions: stringArray,
    openQuestions: stringArray,
    recommendedApproach: { type: "string" },
    reasoningSummary: { type: "string" },
    limitations: stringArray,
  },
};

function fitScoreSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["level", "score", "confidence", "rationale"],
    properties: {
      level: { type: "string", enum: ["high", "medium", "low", "insufficient_data"] },
      score: { type: "integer", minimum: 0, maximum: 100 },
      confidence,
      rationale: { type: "string" },
    },
  };
}