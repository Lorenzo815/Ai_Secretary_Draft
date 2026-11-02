import "server-only";

import { MongoClient, type Db } from "mongodb";

export const DB_NAME = "ai_secretary";

const cache = globalThis as unknown as { __oriaBackofficeMongo?: Promise<MongoClient> };

export function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI não está configurada.");
  cache.__oriaBackofficeMongo ??= new MongoClient(uri, { appName: "oria-backoffice", maxPoolSize: 5 })
    .connect()
    .catch((error) => {
      cache.__oriaBackofficeMongo = undefined;
      throw error;
    });
  return cache.__oriaBackofficeMongo;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(DB_NAME);
}
