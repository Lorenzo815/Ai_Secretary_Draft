import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  AGENT_STRUCTURAL_POLICY,
  buildAgentActionSchema,
  buildAgentDeveloperPrompt,
  getAgentConfiguration,
  updateAgentConfiguration,
  type AgentConfigurationDocument,
} from "@/lib/assistant/agent";
import { listToolMetadata } from "@/lib/assistant/tools";
import { getCalendarSettings } from "@/lib/calendar";
import { listAutomationRules, replaceAutomationRules, type AutomationRuleDocument } from "@/lib/automation";
import {
  getLeadQualificationConfiguration,
  updateLeadQualificationConfiguration,
} from "@/lib/qualification/config";

type AgentConfigurationInput = Omit<
  AgentConfigurationDocument,
  "_id" | "revision" | "contentHash" | "updatedAt" | "updatedBy" | "payment"
> & {
  payment: { signalAmountCents: number };
};

async function authenticate() {
  return getServerSession(authOptions);
}

export async function GET() {
  const session = await authenticate();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const [configuration, qualification, automationRules, calendarSettings] = await Promise.all([
    getAgentConfiguration(),
    getLeadQualificationConfiguration(),
    listAutomationRules(),
    getCalendarSettings(),
  ]);
  return NextResponse.json({
    configuration: sanitizeConfiguration(configuration),
    qualification,
    automationRules,
    availableTools: listToolMetadata(),
    calendarEventTypes: calendarSettings.eventTypes,
    previews: {
      structuralPolicy: AGENT_STRUCTURAL_POLICY,
      developerPrompt: buildAgentDeveloperPrompt(configuration, false),
      iterativeSchema: buildAgentActionSchema(configuration, true),
      finalSchema: buildAgentActionSchema(configuration, false),
    },
  });
}

export async function PUT(request: Request) {
  const session = await authenticate();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const updatedBy = session.user?.email ?? "dashboard";
  const input = (await request.json()) as Record<string, unknown>;

  try {
    if (input.scope === "agent") {
      const expectedRevision = Number(input.expectedRevision);
      const editable = input.configuration as AgentConfigurationInput | undefined;
      if (!Number.isInteger(expectedRevision) || !editable || typeof editable !== "object") {
        return NextResponse.json({ error: "Configuração do agente inválida." }, { status: 400 });
      }
      const current = await getAgentConfiguration();
      const configuration = await updateAgentConfiguration({
        expectedRevision,
        updatedBy,
        configuration: {
          ...editable,
          payment: {
            pixKey: current.payment.pixKey,
            recipientName: current.payment.recipientName,
            signalAmountCents: Number(editable.payment?.signalAmountCents),
          },
        },
      });
      return NextResponse.json({ configuration: sanitizeConfiguration(configuration) });
    }

    if (input.scope === "qualification") {
      const qualification = input.qualification as {
        revision?: number;
        enabled?: boolean;
        prompt?: string;
        maxCompletionTokens?: number;
      } | undefined;
      if (!qualification) return NextResponse.json({ error: "Configuração de qualificação inválida." }, { status: 400 });
      const updated = await updateLeadQualificationConfiguration({
        expectedRevision: Number(qualification.revision),
        enabled: qualification.enabled === true,
        prompt: qualification.prompt ?? "",
        maxCompletionTokens: Number(qualification.maxCompletionTokens),
        updatedBy,
      });
      return NextResponse.json({ qualification: updated });
    }

    if (input.scope === "automation") {
      if (!Array.isArray(input.automationRules)) {
        return NextResponse.json({ error: "Regras de automação inválidas." }, { status: 400 });
      }
      const rules = (input.automationRules as AutomationRuleDocument[]).map((rule) => ({
        ...rule,
        updatedAt: new Date(),
        updatedBy,
      }));
      return NextResponse.json({ automationRules: await replaceAutomationRules({ rules, updatedBy }) });
    }

    return NextResponse.json({ error: "Escopo de configuração desconhecido." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar o Agent Studio.";
    const status = message.includes("outra sessão") || message.includes("foi alterada") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function sanitizeConfiguration(configuration: AgentConfigurationDocument) {
  return {
    revision: configuration.revision,
    contentHash: configuration.contentHash,
    enabled: configuration.enabled,
    identityPrompt: configuration.identityPrompt,
    conversationPolicy: configuration.conversationPolicy,
    offensePolicy: configuration.offensePolicy,
    handoffPolicy: configuration.handoffPolicy,
    knowledge: configuration.knowledge,
    dataCollectionRules: configuration.dataCollectionRules,
    schedulingPlans: configuration.schedulingPlans,
    enabledTools: configuration.enabledTools,
    loopPolicy: configuration.loopPolicy,
    updatedAt: configuration.updatedAt,
    updatedBy: configuration.updatedBy,
    payment: {
      configured: Boolean(configuration.payment.pixKey && configuration.payment.recipientName),
      signalAmountCents: configuration.payment.signalAmountCents,
    },
  };
}