import { Collection, ObjectId } from "mongodb";
import clientPromise from "./mongodb";

export interface UserDocument {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
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

export async function createUser(
  email: string,
  name: string,
  passwordHash: string
): Promise<UserDocument> {
  const users = await getUsersCollection();
  const now = new Date();
  const result = await users.insertOne({
    _id: new ObjectId(),
    email: email.toLowerCase(),
    name,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  return {
    _id: result.insertedId,
    email: email.toLowerCase(),
    name,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };
}

/** Ensure unique index on email */
export async function ensureIndexes(): Promise<void> {
  const users = await getUsersCollection();
  await users.createIndex({ email: 1 }, { unique: true });
}
