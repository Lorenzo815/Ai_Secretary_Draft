import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getAssistantSettings, listFlowDefinitions, updateAssistantSettings, updateFlowDefinition } from "@/lib/assistant";
import { buildAssistantResponseSchema } from "@/lib/assistant/schema";
import { buildDeveloperPrompt, SYSTEM_POLICY } from "@/lib/assistant/prompt";
import { isAssistantToolKey, listToolMetadata, type AssistantToolKey } from "@/lib/assistant/tools";

export async function GET() {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const [flows, settings] = await Promise.all([listFlowDefinitions(), getAssistantSettings()]);
  const availableTools = listToolMetadata();
  const calendarEventTypes = [{ key: "{{eventTypeKey}}", name: "{{eventTypeName}}", durationMinutes: 30, resourceId: "{{resourceId}}" }];
  return NextResponse.json({
    settings,
    structuralPolicy: SYSTEM_POLICY,
    availableTools,
    flows: flows.map((flow) => {
      const version = flow.versions.find((item) => item.version === flow.currentVersion)!;
      return {
        ...flow,
        promptPreviews: version.lifecycle === "tool_cycle"
          ? {
              pre_tool: buildDeveloperPrompt({ flow, version, settings, phase: "pre_tool", calendarNow: "{{calendarNow}}", calendarEventTypes }),
              post_tool: buildDeveloperPrompt({ flow, version, settings, phase: "post_tool", calendarNow: "{{calendarNow}}", calendarEventTypes, toolResult: "{{toolResult}}" }),
            }
          : {
              single: buildDeveloperPrompt({ flow, version, settings, phase: "single", calendarNow: "{{calendarNow}}", calendarEventTypes }),
            },
        outputSchemas: version.lifecycle === "tool_cycle"
          ? {
              pre_tool: buildAssistantResponseSchema(version, "pre_tool"),
              post_tool: buildAssistantResponseSchema(version, "post_tool"),
            }
          : { single: buildAssistantResponseSchema(version, "single") },
      };
    }),
  });
}

export async function PUT(request: Request) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const input = (await request.json()) as Record<string, unknown>;
  if (input.scope === "global") {
    if (
      typeof input.defaultFlowKey !== "string" ||
      typeof input.globalPrompt !== "string" ||
      typeof input.offensePolicy !== "string" ||
      typeof input.handoffPolicy !== "string" ||
      !input.globalPrompt.trim() ||
      !input.offensePolicy.trim() ||
      !input.handoffPolicy.trim()
    ) {
      return NextResponse.json({ error: "Políticas globais inválidas." }, { status: 400 });
    }
    try {
      const settings = await updateAssistantSettings({
        defaultFlowKey: input.defaultFlowKey,
        globalPrompt: input.globalPrompt,
        offensePolicy: input.offensePolicy,
        handoffPolicy: input.handoffPolicy,
      });
      return NextResponse.json({ settings });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Falha ao salvar políticas globais." },
        { status: 400 },
      );
    }
  }
  if (
    typeof input.key !== "string" ||
    typeof input.name !== "string" ||
    typeof input.description !== "string" ||
    typeof input.prompt !== "string" ||
    (input.lifecycle !== "single_call" && input.lifecycle !== "tool_cycle") ||
    typeof input.preToolPrompt !== "string" ||
    typeof input.postToolPrompt !== "string" ||
    !Array.isArray(input.allowedTools) ||
    !input.allowedTools.every((item) => typeof item === "string" && isAssistantToolKey(item)) ||
    typeof input.knowledgeContext !== "string" ||
    typeof input.completionCriteria !== "string" ||
    !Array.isArray(input.allowedTransitions) ||
    !input.allowedTransitions.every((item) => typeof item === "string")
  ) {
    return NextResponse.json({ error: "Dados do fluxo inválidos." }, { status: 400 });
  }
  if (!input.name.trim() || !input.prompt.trim() || !input.completionCriteria.trim()) {
    return NextResponse.json(
      { error: "Nome, instruções e critério de conclusão são obrigatórios." },
      { status: 400 },
    );
  }

  try {
    const flow = await updateFlowDefinition({
      key: input.key,
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      lifecycle: input.lifecycle,
      preToolPrompt: input.preToolPrompt,
      postToolPrompt: input.postToolPrompt,
      allowedTools: input.allowedTools as AssistantToolKey[],
      knowledgeContext: input.knowledgeContext,
      completionCriteria: input.completionCriteria,
      allowedTransitions: input.allowedTransitions,
    });
    return NextResponse.json({ flow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar fluxo." },
      { status: 400 },
    );
  }
}