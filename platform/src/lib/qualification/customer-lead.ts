import "server-only";

import { createHash } from "crypto";
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

const QUALIFICATION_VERSION = 2;
const CLINIC_CITY = "Ponta Grossa/PR";
const CLINIC_TIMEZONE = "America/Sao_Paulo";
export async function analyzeAndSaveCustomerLeadQualification(
  customerId: ObjectId,
  options: { force?: boolean } = {},
) {
  const customer = await findCustomerById(customerId.toString());
  if (!customer) throw new Error("Cliente não encontrado.");
  const profile = getCustomerProfileSnapshot(customer);
  if (!profile.birthDate || !profile.address || !profile.profession) {
    throw new Error("A qualificação exige nascimento, localização e profissão.");
  }
  const taskConfiguration = await getLeadQualificationConfiguration();
  if (!taskConfiguration.enabled) return customer.leadQualification ?? null;

  const messages = await listWhatsAppMessagesForAssistant(
    customerId,
    customer.profile?.updatedAt,
    40,
  );
  const conversation = messages.slice(-20).map((message) => ({
    direction: message.direction,
    timestamp: message.timestamp.toISOString(),
    text: minimizeConversationText(message.body),
  }));
  const input = {
    clinicCity: CLINIC_CITY,
    customerLocation: {
      neighborhood: profile.address.neighborhood,
      city: profile.address.city,
      state: profile.address.state,
    },
    ageYears: calculateAge(profile.birthDate!),
    profession: profile.profession,
    conversation,
  };
  const sourceHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  if (!options.force && customer.leadQualification?.version === QUALIFICATION_VERSION && customer.leadQualification.sourceHash === sourceHash) {
    return customer.leadQualification;
  }

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
    parse: (content) => JSON.parse(content) as QualificationModelOutput,
  });
  const qualification: CustomerLeadQualification = {
    version: QUALIFICATION_VERSION,
    generatedAt: new Date(),
    model: response.model,
    sourceHash,
    profileContext: {
      ageYears: input.ageYears,
      neighborhood: input.customerLocation.neighborhood,
      city: input.customerLocation.city,
      state: input.customerLocation.state,
    },
    ...response.value,
  };
  await saveCustomerLeadQualification(customerId, qualification);
  return qualification;
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
- Em occupationMarketBenchmark, estime a faixa mensal bruta de mercado da profissão informada na geografia disponível. Use-a como um dos componentes de profileFit, sem tratá-la como salário individual. Use faixa ampla, confiança conservadora e ressalvas sobre senioridade, vínculo, especialidade, carga horária e fonte não verificada.
- Descreva somente uma tendência socioeconômica estimada para fins comerciais. Nunca afirme renda, patrimônio, classe social, capacidade de pagamento ou risco financeiro como fatos sobre o paciente.
- Estime distância aproximada entre a localidade informada e o centro do município de Ponta Grossa/PR. Deixe claro que a referência não é o endereço exato da clínica. Use null se não houver segurança.
- Diferencie fatos, sinais explícitos e estimativas. Não invente evidências.
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