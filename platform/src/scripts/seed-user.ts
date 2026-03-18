/**
 * Seed script — creates a test user in the database.
 *
 * Usage:  npm run seed
 *
 * Requires MONGODB_URI in .env.local
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { MongoClient, ObjectId } from "mongodb";
import { hash } from "bcryptjs";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌  Set MONGODB_URI in .env.local first");
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGODB_URI!);
  await client.connect();
  const db = client.db("ai_secretary");
  const users = db.collection("users");

  // Create unique index
  await users.createIndex({ email: 1 }, { unique: true });

  const email = "admin@example.com";
  const existing = await users.findOne({ email });

  if (existing) {
    console.log(`ℹ️  User "${email}" already exists — skipping.`);
  } else {
    const passwordHash = await hash("password123", 12);
    await users.insertOne({
      _id: new ObjectId(),
      email,
      name: "Admin",
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅  Created user "${email}" with password "password123"`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
