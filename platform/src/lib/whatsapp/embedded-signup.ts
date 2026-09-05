import "server-only";

import type { Collection } from "mongodb";
import clientPromise from "../mongodb";

const DB_NAME = "ai_secretary";
const COLLECTION_NAME = "whatsapp_embedded_signup_config";
const DEFAULT_GRAPH_VERSION = "v25.0";

export interface EmbeddedSignupConfiguration {
  _id: "active";
  appId: string;
  configurationId: string;
  graphVersion: string;
  updatedAt: Date | null;
}

async function getCollection(): Promise<Collection<EmbeddedSignupConfiguration>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<EmbeddedSignupConfiguration>(COLLECTION_NAME);
}

export async function getEmbeddedSignupConfiguration(): Promise<EmbeddedSignupConfiguration> {
  return (await (await getCollection()).findOne({ _id: "active" })) ?? {
    _id: "active",
    appId: "",
    configurationId: "",
    graphVersion: DEFAULT_GRAPH_VERSION,
    updatedAt: null,
  };
}

export async function updateEmbeddedSignupConfiguration(input: {
  appId: string;
  configurationId: string;
}) {
  const appId = validateMetaId(input.appId, "App ID");
  const configurationId = validateMetaId(input.configurationId, "Configuration ID");
  const next: EmbeddedSignupConfiguration = {
    _id: "active",
    appId,
    configurationId,
    graphVersion: DEFAULT_GRAPH_VERSION,
    updatedAt: new Date(),
  };
  await (await getCollection()).replaceOne({ _id: "active" }, next, { upsert: true });
  return next;
}

function validateMetaId(value: string, label: string) {
  const normalized = value.trim();
  if (!/^\d{5,30}$/.test(normalized)) {
    throw new Error(`${label} deve conter apenas números.`);
  }
  return normalized;
}