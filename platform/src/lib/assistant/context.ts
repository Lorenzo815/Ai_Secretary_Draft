import "server-only";

import { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { listWhatsAppMessagesForAssistant } from "../whatsapp/messages";

interface ConversationStateDocument {
  _id: ObjectId;
  customerId: ObjectId;
  summary: string;
  summarizedThrough: Date;
  updatedAt: Date;
}

const DB_NAME = "ai_secretary";

async function getStatesCollection(): Promise<Collection<ConversationStateDocument>> {
  const client = await clientPromise;
  return client.db(DB_NAME).collection<ConversationStateDocument>("assistant_conversation_states");
}

export async function loadAssistantContext(customerId: ObjectId, messageLimit: number) {
  const states = await getStatesCollection();
  const state = await states.findOne({ customerId });
  const messages = await listWhatsAppMessagesForAssistant(
    customerId,
    undefined,
    messageLimit,
  );

  return { summary: state?.summary ?? "Sem contexto anterior.", messages };
}

export async function getAssistantConversationState(customerId: ObjectId) {
  const states = await getStatesCollection();
  return states.findOne({ customerId });
}

export async function saveAssistantContext(input: {
  customerId: ObjectId;
  summary: string;
  summarizedThrough: Date;
}) {
  const states = await getStatesCollection();
  await states.updateOne(
    { customerId: input.customerId },
    {
      $set: {
        summary: input.summary.slice(0, 8_000),
        summarizedThrough: input.summarizedThrough,
        updatedAt: new Date(),
      },
      $setOnInsert: { _id: new ObjectId(), customerId: input.customerId },
    },
    { upsert: true },
  );
  await states.createIndex({ customerId: 1 }, { unique: true });
}