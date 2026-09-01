import "server-only";

import { AzureOpenAI } from "openai";
import { getAssistantConfig } from "./config";
import {
  buildAssistantMessages,
  parseAssistantGeneration,
} from "./prompt";
import type { WhatsAppMessageDocument } from "../whatsapp/messages";
import type { CustomerProfileSnapshot } from "../crm";
import { getAssistantSettings, type CustomerFlowDocument, type FlowDefinitionDocument, type FlowVersion } from "./flows";
import { DateTime } from "luxon";
import { getActiveFirstVisitOption, getCalendarSettings } from "../calendar";
import { getReferencedFirstVisitOptionId } from "../calendar/first-visit";
import { buildAssistantResponseSchema, type AssistantCallPhase } from "./schema";
import type { ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import { completeAssistantModelTrace, failAssistantModelTrace, startAssistantModelTrace } from "./model-trace";

let client: AzureOpenAI | undefined;

export async function generateAssistantResponse(input: {
  summary: string;
  messages: WhatsAppMessageDocument[];
  flow: FlowDefinitionDocument;
  version: FlowVersion;
  assignment: CustomerFlowDocument;
  toolResult?: string;
  phase?: AssistantCallPhase;
  customerProfile: CustomerProfileSnapshot;
  customerId: ObjectId;
}) {
  const config = getAssistantConfig();
  const callStartedAt = Date.now();
  const trace = {
    customerId: input.customerId.toString(),
    flowKey: input.flow.key,
    flowVersion: input.version.version,
    phase: input.phase ?? (input.version.lifecycle === "tool_cycle" ? "pre_tool" : "single"),
  };
  const referencedOptionId = getReferencedFirstVisitOptionId(input.assignment.state.notes);
  const [calendarSettings, assistantSettings, activeFirstVisitOption] = await Promise.all([
    getCalendarSettings(),
    getAssistantSettings(),
    getActiveFirstVisitOption(
      input.customerId,
      referencedOptionId ? new MongoObjectId(referencedOptionId) : undefined,
    ),
  ]);
  const phase = input.phase ?? (input.version.lifecycle === "tool_cycle" ? "pre_tool" : "single");
  client ??= new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
    maxRetries: 0,
    timeout: config.modelRequestTimeoutMs,
  });

  const messages = buildAssistantMessages({
      flow: input.flow,
      version: input.version,
      assignment: input.assignment,
      summary: input.summary,
      messages: input.messages,
      toolResult: input.toolResult,
      calendarNow: DateTime.now().setZone(calendarSettings.timezone).toISO() ?? undefined,
      calendarEventTypes: calendarSettings.eventTypes.map((eventType) => ({
        key: eventType.key,
        name: eventType.name,
        durationMinutes: eventType.durationMinutes,
        resourceId: eventType.resourceId,
      })),
      settings: assistantSettings,
      phase,
      customerProfile: input.customerProfile,
      activeFirstVisitOption,
    });
  const traceId = await startAssistantModelTrace({
    customerId: input.customerId,
    flowKey: input.flow.key,
    flowVersion: input.version.version,
    phase,
    messageCount: messages.length,
  });
  console.info("Assistant model call started", { ...trace, messageCount: messages.length });

  try {
    const response = await client.chat.completions.create({
      model: config.deployment,
      messages,
      max_completion_tokens: 4_096,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "clinic_flow_response",
          strict: true,
          schema: buildAssistantResponseSchema(
            input.version,
            phase,
          ),
        },
      },
    });

    const content = response.choices[0]?.message.content ?? null;
    const generation = parseAssistantGeneration(content);
    await completeAssistantModelTrace({
      traceId,
      durationMs: Date.now() - callStartedAt,
      requestId: response._request_id,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
      generation,
    }).catch((traceError) => console.error("Assistant model trace could not be completed", traceError));
    console.info("Assistant model call completed", {
      ...trace,
      durationMs: Date.now() - callStartedAt,
      requestId: response._request_id,
      finishReason: response.choices[0]?.finish_reason,
      usage: response.usage,
      result: {
        decision: generation.decision,
        reply: generation.reply,
        stage: generation.state.stage,
        collectedDataKeys: generation.state.collectedData.map((item) => item.key),
        missingData: generation.state.missingData,
        notes: generation.state.notes,
        transition: generation.transition,
        toolCalls: generation.toolCalls.map((call) => ({ tool: call.tool, argumentKeys: Object.keys(call.arguments) })),
      },
    });
    return generation;
  } catch (error) {
    await failAssistantModelTrace({ traceId, durationMs: Date.now() - callStartedAt, error })
      .catch((traceError) => console.error("Assistant model trace failure could not be recorded", traceError));
    console.error("Assistant model call failed", {
      ...trace,
      durationMs: Date.now() - callStartedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}