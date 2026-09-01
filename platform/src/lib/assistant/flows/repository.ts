import "server-only";

import type { Collection } from "mongodb";
import clientPromise from "../../mongodb";
import type {
  AssistantSettingsDocument,
  CustomerFlowDocument,
  FlowDefinitionDocument,
  FlowHistoryDocument,
  FlowRunDocument,
} from "./contracts";

const DB_NAME = "ai_secretary";

export async function getFlowsCollection(): Promise<Collection<FlowDefinitionDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FlowDefinitionDocument>("assistant_flows");
}

export async function getAssignmentsCollection(): Promise<Collection<CustomerFlowDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<CustomerFlowDocument>("assistant_customer_flows");
}

export async function getHistoryCollection(): Promise<Collection<FlowHistoryDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FlowHistoryDocument>("assistant_flow_history");
}

export async function getRunsCollection(): Promise<Collection<FlowRunDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<FlowRunDocument>("assistant_flow_runs");
}

export async function getSettingsCollection(): Promise<Collection<AssistantSettingsDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<AssistantSettingsDocument>("assistant_settings");
}