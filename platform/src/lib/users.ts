import { Collection, ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import type { Permissions } from "./access/contracts";

export interface UserDocument {
  _id: ObjectId;
  companyId: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  permissions?: Permissions;
  disabled?: boolean;
  sessionVersion?: number;
}

const DB_NAME = "ai_secretary";

export async function getUsersCollection(): Promise<Collection<UserDocument>> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  return db.collection<UserDocument>("users");
}

export async function findUserByEmail(
  email: string
): Promise<UserDocument | null> {
  const users = await getUsersCollection();
  return users.findOne({ email: email.toLowerCase() });
}

/** Ensure unique index on email */
export async function ensureIndexes(): Promise<void> {
  const users = await getUsersCollection();
  await users.createIndex({ email: 1 }, { unique: true });
}
