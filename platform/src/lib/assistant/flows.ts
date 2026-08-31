import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";

export interface FlowVersion {
  version: number;
  prompt: string;
  lifecycle: "single_call" | "tool_cycle";
  preToolPrompt: string;
  postToolPrompt: string;
  allowedTools: AssistantToolKey[];
  knowledgeContext: string;
  completionCriteria: string;
  allowedTransitions: string[];
  createdAt: Date;
}

export type AssistantToolKey = "calendar.check_availability" | "calendar.book_appointment";

export interface AssistantSettingsDocument {
  key: "global";
  defaultFlowKey: string;
  globalPrompt: string;
  offensePolicy: string;
  handoffPolicy: string;
  version: number;
  updatedAt: Date;
}

export interface FlowDefinitionDocument {
  _id: ObjectId;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  currentVersion: number;
  versions: FlowVersion[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FlowState {
  stage: string;
  collectedData: Array<{ key: string; value: string }>;
  missingData: string[];
  notes: string[];
}

export interface CustomerFlowDocument {
  _id: ObjectId;
  customerId: ObjectId;
  flowKey: string;
  flowVersion: number;
  status: "active" | "completed";
  state: FlowState;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  completionCode?: string;
  completionReason?: string;
}

export interface FlowTransitionInput {
  action: "stay" | "complete" | "transition";
  targetFlowKey?: string;
  reasonCode?: string;
  reason?: string;
}

interface FlowHistoryDocument {
  _id: ObjectId;
  customerId: ObjectId;
  flowKey: string;
  flowVersion: number;
  startedAt: Date;
  completedAt: Date;
  completionCode: string;
  completionReason: string;
  finalState: FlowState;
  nextFlowKey?: string;
  source: "assistant" | "manual";
}

interface FlowRunDocument {
  _id: ObjectId;
  customerId: ObjectId;
  jobRevision: number;
  flowKey: string;
  flowVersion: number;
  decision: string;
  reply: string;
  state: FlowState;
  transition: FlowTransitionInput;
  calendarAction?: {
    action: string;
    dateIntent?: string | null;
    fromDate: string | null;
    toDate: string | null;
    period: string | null;
    startAt: string | null;
    confirmedByCustomer: boolean;
    notes: string | null;
  };
  calendarToolResult?: string;
  createdAt: Date;
}

const DB_NAME = "ai_secretary";
const DEFAULT_FLOW_KEY = "initial_triage";
const DEFAULT_GLOBAL_PROMPT = "Responda de forma objetiva, acolhedora e profissional, usando português brasileiro.";
const DEFAULT_OFFENSE_POLICY = "Não confronte nem reproduza ofensas. Estabeleça um limite breve e ofereça ajuda apenas para assuntos administrativos da clínica.";
const DEFAULT_HANDOFF_POLICY = "Encaminhe para a equipe humana quando faltar informação confirmada, houver exceção operacional, solicitação sensível ou necessidade de decisão não autorizada.";

const defaultFlows = [
  {
    key: DEFAULT_FLOW_KEY,
    name: "Triagem inicial",
    description: "Entende a necessidade administrativa e direciona o próximo atendimento.",
    prompt: "Identifique o objetivo administrativo do contato. Colete somente informações mínimas e não faça triagem médica. Quando o objetivo estiver claro, encaminhe para agendamento ou acompanhamento.",
    completionCriteria: "Objetivo administrativo identificado e próximo fluxo definido, ou necessidade de atendimento humano confirmada.",
    allowedTransitions: ["schedule_appointment", "follow_up"],
    lifecycle: "single_call" as const,
    allowedTools: [] as AssistantToolKey[],
  },
  {
    key: "schedule_appointment",
    name: "Agendar atendimento",
    description: "Coleta preferências e conduz confirmação de agendamento.",
    prompt: "Ajude com agendamento, reagendamento ou cancelamento. Não confirme disponibilidade que não esteja no contexto autorizado. Encaminhe à equipe quando faltar integração ou confirmação.",
    completionCriteria: "Solicitação registrada e confirmada pela fonte autorizada, cancelada pelo cliente ou encaminhada à equipe com motivo.",
    allowedTransitions: ["follow_up", "initial_triage"],
    lifecycle: "tool_cycle" as const,
    allowedTools: ["calendar.check_availability", "calendar.book_appointment"] as AssistantToolKey[],
  },
  {
    key: "follow_up",
    name: "Follow-up",
    description: "Conduz confirmações, orientações pré-consulta e retornos administrativos.",
    prompt: "Realize apenas acompanhamentos administrativos previstos no contexto autorizado, sem oferecer orientação médica. Ao solicitar confirmação de um agendamento, informe a data e o horário e termine com uma pergunta direta: Você confirma sua presença? O envio do lembrete não é uma confirmação do cliente: mantenha o fluxo ativo e aguarde uma resposta posterior. Só registre confirmação quando o cliente responder de forma explícita e inequívoca. Se ele pedir reagendamento ou cancelamento, não trate isso como confirmação e conduza a solicitação ao fluxo adequado.",
    completionCriteria: "O fluxo só pode ser concluído após uma resposta explícita do cliente confirmando presença, após solicitação inequívoca de reagendamento ou cancelamento devidamente encaminhada, ou após encaminhamento humano concluído. O mero envio ou recebimento do lembrete não conclui o fluxo.",
    allowedTransitions: ["schedule_appointment", "initial_triage"],
    lifecycle: "single_call" as const,
    allowedTools: [] as AssistantToolKey[],
  },
];

async function getFlowsCollection(): Promise<Collection<FlowDefinitionDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FlowDefinitionDocument>("assistant_flows");
}

async function getAssignmentsCollection(): Promise<Collection<CustomerFlowDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CustomerFlowDocument>("assistant_customer_flows");
}

async function getHistoryCollection(): Promise<Collection<FlowHistoryDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FlowHistoryDocument>("assistant_flow_history");
}

async function getRunsCollection(): Promise<Collection<FlowRunDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FlowRunDocument>("assistant_flow_runs");
}

async function getSettingsCollection(): Promise<Collection<AssistantSettingsDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AssistantSettingsDocument>("assistant_settings");
}

export async function listFlowDefinitions() {
  await ensureDefaultFlows();
  const flows = await (await getFlowsCollection()).find({}).sort({ createdAt: 1 }).toArray();
  return flows.map(normalizeFlowDefinition);
}

export async function getAssistantSettings() {
  await ensureDefaultFlows();
  const settings = await (await getSettingsCollection()).findOne({ key: "global" });
  if (!settings) throw new Error("Configuração global não encontrada.");
  return settings;
}

export async function updateAssistantSettings(input: {
  defaultFlowKey: string;
  globalPrompt: string;
  offensePolicy: string;
  handoffPolicy: string;
}) {
  await ensureDefaultFlows();
  if (!(await (await getFlowsCollection()).findOne({ key: input.defaultFlowKey, enabled: true }))) {
    throw new Error("O fluxo default deve existir e estar ativo.");
  }
  const settings = await getSettingsCollection();
  const current = await settings.findOne({ key: "global" });
  await settings.updateOne(
    { key: "global" },
    { $set: {
      defaultFlowKey: input.defaultFlowKey,
      globalPrompt: input.globalPrompt.trim().slice(0, 20_000),
      offensePolicy: input.offensePolicy.trim().slice(0, 4_000),
      handoffPolicy: input.handoffPolicy.trim().slice(0, 4_000),
      version: (current?.version ?? 0) + 1,
      updatedAt: new Date(),
    } },
  );
  return settings.findOne({ key: "global" });
}

export async function updateFlowDefinition(input: {
  key: string;
  name: string;
  description: string;
  prompt: string;
  lifecycle: "single_call" | "tool_cycle";
  preToolPrompt: string;
  postToolPrompt: string;
  allowedTools: AssistantToolKey[];
  knowledgeContext: string;
  completionCriteria: string;
  allowedTransitions: string[];
}) {
  await ensureDefaultFlows();
  const flows = await getFlowsCollection();
  const current = await flows.findOne({ key: input.key });
  if (!current) throw new Error("Fluxo não encontrado.");
  const version = current.currentVersion + 1;
  const now = new Date();
  await flows.updateOne(
    { _id: current._id, currentVersion: current.currentVersion },
    {
      $set: {
        name: input.name.trim().slice(0, 100),
        description: input.description.trim().slice(0, 300),
        currentVersion: version,
        updatedAt: now,
      },
      $push: {
        versions: {
          version,
          prompt: input.prompt.trim().slice(0, 20_000),
          lifecycle: input.lifecycle,
          preToolPrompt: input.preToolPrompt.trim().slice(0, 12_000),
          postToolPrompt: input.postToolPrompt.trim().slice(0, 12_000),
          allowedTools: input.lifecycle === "tool_cycle" ? [...new Set(input.allowedTools)] : [],
          knowledgeContext: input.knowledgeContext.trim().slice(0, 20_000),
          completionCriteria: input.completionCriteria.trim().slice(0, 4_000),
          allowedTransitions: [...new Set(input.allowedTransitions)].filter(
            (key) => key !== input.key,
          ),
          createdAt: now,
        },
      },
    },
  );
  return flows.findOne({ _id: current._id });
}

export async function getOrAssignCustomerFlow(customerId: ObjectId) {
  await ensureDefaultFlows();
  const assignments = await getAssignmentsCollection();
  const existing = await assignments.findOne({ customerId });
  if (existing) return existing;
  const settings = await (await getSettingsCollection()).findOne({ key: "global" });
  return assignCustomerFlow(customerId, settings?.defaultFlowKey ?? DEFAULT_FLOW_KEY, "manual", "Atribuição inicial automática");
}

export async function assignCustomerFlow(
  customerId: ObjectId,
  flowKey: string,
  source: "assistant" | "manual",
  reason: string,
  initialState?: FlowState,
) {
  const flow = await getCurrentFlowVersion(flowKey);
  const assignments = await getAssignmentsCollection();
  const previous = await assignments.findOne({ customerId });
  const now = new Date();

  if (previous?.status === "active") {
    await archiveFlow(previous, {
      action: "transition",
      targetFlowKey: flowKey,
      reasonCode: source === "manual" ? "manual_reassignment" : "flow_transition",
      reason,
    }, source, now);
  }

  const next: CustomerFlowDocument = {
    _id: previous?._id ?? new ObjectId(),
    customerId,
    flowKey,
    flowVersion: flow.version.version,
    status: "active",
    state: initialState ?? emptyFlowState(),
    startedAt: now,
    updatedAt: now,
  };
  await assignments.replaceOne({ customerId }, next, { upsert: true });
  return next;
}

export async function getCustomerFlowOverview(customerId: ObjectId) {
  const [assignment, flows, history] = await Promise.all([
    getOrAssignCustomerFlow(customerId),
    listFlowDefinitions(),
    getFlowHistory(customerId),
  ]);
  return { assignment, flows, history };
}

export async function getFlowRuntime(customerId: ObjectId) {
  const assignment = await getOrAssignCustomerFlow(customerId);
  if (assignment.status !== "active") return null;
  const flow = await getFlowVersion(assignment.flowKey, assignment.flowVersion);
  if (!flow) throw new Error("A versão atribuída do fluxo não existe.");
  return { assignment, definition: flow.definition, version: flow.version };
}

export async function applyFlowResult(input: {
  customerId: ObjectId;
  flowKey: string;
  flowVersion: number;
  state: FlowState;
  transition: FlowTransitionInput;
}) {
  const assignments = await getAssignmentsCollection();
  const current = await assignments.findOne({
    customerId: input.customerId,
    flowKey: input.flowKey,
    flowVersion: input.flowVersion,
    status: "active",
  });
  if (!current) return { applied: false as const };

  if (input.transition.action === "stay") {
    await assignments.updateOne(
      { _id: current._id, flowKey: current.flowKey, flowVersion: current.flowVersion },
      { $set: { state: input.state, updatedAt: new Date() } },
    );
    return { applied: true as const };
  }

  const reason = input.transition.reason?.trim();
  const reasonCode = input.transition.reasonCode?.trim();
  if (!reason || !reasonCode) throw new Error("Conclusões de fluxo exigem código e motivo.");
  const runtime = await getFlowVersion(current.flowKey, current.flowVersion);
  const target = input.transition.targetFlowKey;
  if (input.transition.action === "transition") {
    if (!target || !runtime?.version.allowedTransitions.includes(target)) {
      throw new Error("A transição solicitada não é permitida por esta versão do fluxo.");
    }
    await assignments.updateOne(
      { _id: current._id, flowKey: current.flowKey, flowVersion: current.flowVersion },
      { $set: { state: input.state, updatedAt: new Date() } },
    );
    await assignCustomerFlow(input.customerId, target, "assistant", reason, input.state);
    return { applied: true as const };
  }

  const now = new Date();
  await archiveFlow({ ...current, state: input.state }, input.transition, "assistant", now);
  await assignments.updateOne(
    { _id: current._id, flowKey: current.flowKey, flowVersion: current.flowVersion },
    {
      $set: {
        status: "completed",
        state: input.state,
        completedAt: now,
        completionCode: reasonCode,
        completionReason: reason,
        updatedAt: now,
      },
    },
  );
  return { applied: true as const };
}

export async function recordFlowRun(run: Omit<FlowRunDocument, "_id" | "createdAt">) {
  await (await getRunsCollection()).insertOne({ ...run, _id: new ObjectId(), createdAt: new Date() });
}

async function getFlowHistory(customerId: ObjectId) {
  return (await getHistoryCollection())
    .find({ customerId })
    .sort({ completedAt: -1 })
    .limit(100)
    .toArray();
}

async function archiveFlow(
  flow: CustomerFlowDocument,
  transition: FlowTransitionInput,
  source: "assistant" | "manual",
  completedAt: Date,
) {
  await (await getHistoryCollection()).insertOne({
    _id: new ObjectId(),
    customerId: flow.customerId,
    flowKey: flow.flowKey,
    flowVersion: flow.flowVersion,
    startedAt: flow.startedAt,
    completedAt,
    completionCode: transition.reasonCode ?? "completed",
    completionReason: transition.reason ?? "Fluxo concluído",
    finalState: flow.state,
    nextFlowKey: transition.targetFlowKey,
    source,
  });
}

async function getCurrentFlowVersion(key: string) {
  await ensureDefaultFlows();
  const definition = await (await getFlowsCollection()).findOne({ key, enabled: true });
  if (!definition) throw new Error("Fluxo indisponível.");
  const version = definition.versions.find((item) => item.version === definition.currentVersion);
  if (!version) throw new Error("Versão atual do fluxo não encontrada.");
  return { definition: normalizeFlowDefinition(definition), version: normalizeFlowVersion(version, key) };
}

async function getFlowVersion(key: string, versionNumber: number) {
  const definition = await (await getFlowsCollection()).findOne({ key });
  const version = definition?.versions.find((item) => item.version === versionNumber);
  return definition && version ? {
    definition: normalizeFlowDefinition(definition),
    version: normalizeFlowVersion(version, key),
  } : null;
}

async function ensureDefaultFlows() {
  const flows = await getFlowsCollection();
  const now = new Date();
  await Promise.all(defaultFlows.map((flow) =>
    flows.updateOne(
      { key: flow.key },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          key: flow.key,
          name: flow.name,
          description: flow.description,
          enabled: true,
          currentVersion: 1,
          versions: [{
            version: 1,
            prompt: flow.prompt,
            lifecycle: flow.lifecycle,
            preToolPrompt: flow.lifecycle === "tool_cycle" ? "Determine se uma ferramenta é necessária e preencha somente uma ação autorizada com argumentos completos." : "",
            postToolPrompt: flow.lifecycle === "tool_cycle" ? "Responda usando exclusivamente o resultado real da ferramenta. Não invente sucesso, disponibilidade ou efeitos." : "",
            allowedTools: flow.allowedTools,
            knowledgeContext: "Configure aqui somente informações confirmadas da clínica para este fluxo.",
            completionCriteria: flow.completionCriteria,
            allowedTransitions: flow.allowedTransitions,
            createdAt: now,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    ),
  ));
  await Promise.all([
    flows.createIndex({ key: 1 }, { unique: true }),
    (await getAssignmentsCollection()).createIndex({ customerId: 1 }, { unique: true }),
    (await getHistoryCollection()).createIndex({ customerId: 1, completedAt: -1 }),
    (await getRunsCollection()).createIndex({ customerId: 1, createdAt: -1 }),
    (await getSettingsCollection()).updateOne(
      { key: "global" },
      { $setOnInsert: {
        key: "global",
        defaultFlowKey: DEFAULT_FLOW_KEY,
        globalPrompt: DEFAULT_GLOBAL_PROMPT,
        offensePolicy: DEFAULT_OFFENSE_POLICY,
        handoffPolicy: DEFAULT_HANDOFF_POLICY,
        version: 1,
        updatedAt: now,
      } },
      { upsert: true },
    ),
  ]);
}

function normalizeFlowDefinition(flow: FlowDefinitionDocument): FlowDefinitionDocument {
  return {
    ...flow,
    versions: flow.versions.map((version) => normalizeFlowVersion(version, flow.key)),
  };
}

function normalizeFlowVersion(version: FlowVersion, flowKey: string): FlowVersion {
  const toolEnabled = flowKey === "schedule_appointment";
  return {
    ...version,
    lifecycle: version.lifecycle ?? (toolEnabled ? "tool_cycle" : "single_call"),
    preToolPrompt: version.preToolPrompt ?? (toolEnabled ? "Determine se uma ferramenta é necessária e forneça argumentos completos." : ""),
    postToolPrompt: version.postToolPrompt ?? (toolEnabled ? "Use exclusivamente o resultado real da ferramenta na resposta final." : ""),
    allowedTools: version.allowedTools ?? (toolEnabled ? ["calendar.check_availability", "calendar.book_appointment"] : []),
  };
}

function emptyFlowState(): FlowState {
  return { stage: "inicio", collectedData: [], missingData: [], notes: [] };
}