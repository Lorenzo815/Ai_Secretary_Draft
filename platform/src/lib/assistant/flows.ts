import "server-only";

import { ObjectId } from "mongodb";
import type { AssistantToolKey } from "./tools";
import {
  DEFAULT_FLOW_KEY,
  DEFAULT_GLOBAL_PROMPT,
  DEFAULT_HANDOFF_POLICY,
  LEGACY_DEFAULT_GLOBAL_PROMPT,
  DEFAULT_OFFENSE_POLICY,
  DEFAULT_PAYMENT_SETTINGS,
  flowCatalog,
} from "./flows/catalog";
import type {
  CustomerFlowDocument,
  FlowDefinitionDocument,
  FlowRunDocument,
  FlowState,
  FlowTransitionInput,
  FlowVersion,
} from "./flows/contracts";
import {
  getAssignmentsCollection,
  getFlowsCollection,
  getHistoryCollection,
  getRunsCollection,
  getSettingsCollection,
} from "./flows/repository";

export type {
  AssistantSettingsDocument,
  CustomerFlowDocument,
  FlowDefinitionDocument,
  FlowState,
  FlowTransitionInput,
  FlowVersion,
} from "./flows/contracts";

export async function listFlowDefinitions() {
  await ensureDefaultFlows();
  const flows = await (await getFlowsCollection()).find({}).sort({ createdAt: 1 }).toArray();
  return flows.map(normalizeFlowDefinition);
}

export async function getAssistantSettings() {
  await ensureDefaultFlows();
  const settings = await (await getSettingsCollection()).findOne({ key: "global" });
  if (!settings) throw new Error("Configuração global não encontrada.");
  return {
    ...settings,
    processingEnabled: settings.processingEnabled !== false,
    payment: settings.payment ?? DEFAULT_PAYMENT_SETTINGS,
  };
}

export async function updatePaymentSettings(input: {
  pixKey: string;
  recipientName: string;
  signalAmountCents: number;
}) {
  await ensureDefaultFlows();
  const pixKey = input.pixKey.trim().slice(0, 200);
  const recipientName = input.recipientName.trim().slice(0, 200);
  if (!Number.isInteger(input.signalAmountCents) || input.signalAmountCents < 100 || input.signalAmountCents > 1_000_000) {
    throw new Error("O valor do sinal deve estar entre R$ 1,00 e R$ 10.000,00.");
  }
  const settings = await getSettingsCollection();
  await settings.updateOne(
    { key: "global" },
    {
      $set: {
        payment: { pixKey, recipientName, signalAmountCents: input.signalAmountCents },
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    },
  );
  return settings.findOne({ key: "global" });
}

export async function setAssistantProcessingEnabled(processingEnabled: boolean) {
  await ensureDefaultFlows();
  const settings = await getSettingsCollection();
  await settings.updateOne(
    { key: "global" },
    { $set: { processingEnabled, updatedAt: new Date() } },
  );
  return { processingEnabled };
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

export async function completeActiveCustomerFlow(
  customerId: ObjectId,
  reasonCode: string,
  reason: string,
) {
  const assignments = await getAssignmentsCollection();
  const current = await assignments.findOne({ customerId, status: "active" });
  if (!current) return { applied: false as const };

  const now = new Date();
  const transition: FlowTransitionInput = {
    action: "complete",
    continueImmediately: false,
    reasonCode,
    reason,
  };
  await archiveFlow(current, transition, "manual", now);
  await assignments.updateOne(
    { _id: current._id, status: "active" },
    {
      $set: {
        status: "completed",
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
  for (const flow of flowCatalog) {
    const current = await flows.findOne({ key: flow.key });
    const nextVersion = (current?.currentVersion ?? 0) + 1;
    if (!current) {
      await flows.insertOne({
          _id: new ObjectId(),
          key: flow.key,
          catalogRevision: flow.revision,
          name: flow.name,
          description: flow.description,
          enabled: true,
          currentVersion: nextVersion,
          versions: [{
            version: nextVersion,
            prompt: flow.prompt,
            lifecycle: flow.lifecycle,
            preToolPrompt: flow.lifecycle === "tool_cycle" ? flow.preToolPrompt ?? "Determine se uma ferramenta é necessária e preencha somente uma ação autorizada com argumentos completos." : "",
            postToolPrompt: flow.lifecycle === "tool_cycle" ? flow.postToolPrompt ?? "Responda usando exclusivamente o resultado real da ferramenta. Não invente sucesso, disponibilidade ou efeitos." : "",
            allowedTools: flow.allowedTools,
            knowledgeContext: flow.knowledgeContext,
            completionCriteria: flow.completionCriteria,
            allowedTransitions: flow.allowedTransitions,
            createdAt: now,
          }],
          createdAt: now,
          updatedAt: now,
      });
    } else if ((current.catalogRevision ?? 0) < flow.revision) {
      await flows.updateOne(
        { _id: current._id, currentVersion: current.currentVersion },
        {
          $set: {
            catalogRevision: flow.revision,
            name: flow.name,
            description: flow.description,
            currentVersion: nextVersion,
            updatedAt: now,
          },
          $push: { versions: {
            version: nextVersion,
            prompt: flow.prompt,
            lifecycle: flow.lifecycle,
            preToolPrompt: flow.lifecycle === "tool_cycle" ? flow.preToolPrompt ?? "Determine se uma ferramenta é necessária e preencha somente uma ação autorizada com argumentos completos." : "",
            postToolPrompt: flow.lifecycle === "tool_cycle" ? flow.postToolPrompt ?? "Responda usando exclusivamente o resultado real da ferramenta. Não invente sucesso, disponibilidade ou efeitos." : "",
            allowedTools: flow.allowedTools,
            knowledgeContext: flow.knowledgeContext,
            completionCriteria: flow.completionCriteria,
            allowedTransitions: flow.allowedTransitions,
            createdAt: now,
          } },
        },
      );
    }
  }
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
        processingEnabled: true,
        payment: DEFAULT_PAYMENT_SETTINGS,
        globalPrompt: DEFAULT_GLOBAL_PROMPT,
        offensePolicy: DEFAULT_OFFENSE_POLICY,
        handoffPolicy: DEFAULT_HANDOFF_POLICY,
        version: 1,
        updatedAt: now,
      } },
      { upsert: true },
    ),
  ]);
  await (await getSettingsCollection()).updateOne(
    { key: "global", globalPrompt: LEGACY_DEFAULT_GLOBAL_PROMPT },
    {
      $set: { globalPrompt: DEFAULT_GLOBAL_PROMPT, updatedAt: now },
      $inc: { version: 1 },
    },
  );
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
    allowedTools: version.allowedTools ?? [],
  };
}

function emptyFlowState(): FlowState {
  return { stage: "inicio", collectedData: [], missingData: [], notes: [] };
}