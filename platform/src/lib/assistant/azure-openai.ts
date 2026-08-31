import "server-only";

import { AzureOpenAI } from "openai";
import { getAssistantConfig } from "./config";
import {
  buildAssistantMessages,
  parseAssistantGeneration,
} from "./prompt";
import type { WhatsAppMessageDocument } from "../whatsapp/messages";
import { getAssistantSettings, type CustomerFlowDocument, type FlowDefinitionDocument, type FlowVersion } from "./flows";
import { DateTime } from "luxon";
import { getCalendarSettings } from "../calendar";
import { buildAssistantResponseSchema, type AssistantCallPhase } from "./schema";

let client: AzureOpenAI | undefined;

export async function generateAssistantResponse(input: {
  summary: string;
  messages: WhatsAppMessageDocument[];
  flow: FlowDefinitionDocument;
  version: FlowVersion;
  assignment: CustomerFlowDocument;
  calendarToolResult?: string;
  triggerContext?: string;
  phase?: AssistantCallPhase;
}) {
  const config = getAssistantConfig();
  const [calendarSettings, assistantSettings] = await Promise.all([
    getCalendarSettings(),
    getAssistantSettings(),
  ]);
  const phase = input.phase ?? (input.version.lifecycle === "tool_cycle" ? "pre_tool" : "single");
  client ??= new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
  });

  const response = await client.chat.completions.create({
    model: config.deployment,
    messages: buildAssistantMessages({
      flow: input.flow,
      version: input.version,
      assignment: input.assignment,
      summary: input.summary,
      messages: input.messages,
      calendarToolResult: input.calendarToolResult,
      triggerContext: input.triggerContext,
      calendarNow: DateTime.now().setZone(calendarSettings.timezone).toISO() ?? undefined,
      settings: assistantSettings,
      phase,
    }),
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

  return parseAssistantGeneration(response.choices[0]?.message.content ?? null);
}