// Replaces global unique indexes with per-company ones, so a second clinic can hold the same
// patient phone/CPF and book the same provider ids and times as the original clinic.
// Dry run by default (read-only). Writes only with --apply.
//   node src/scripts/migrate-tenant-indexes.mjs [--apply] [--env path/to/.env]
// Run after the release that creates the per-company indexes is deployed; older releases
// recreate the global indexes on start.
import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const envIndex = args.indexOf("--env");
const envFile = envIndex >= 0 ? args[envIndex + 1] : ".env.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.MONGODB_URI) throw new Error(`MONGODB_URI not found (env file: ${envFile}).`);

const PLAN = [
  {
    collection: "crm_customers",
    create: {
      key: { companyId: 1, "identifiers.kind": 1, "identifiers.value": 1 },
      options: { name: "company_customer_identifier_unique", unique: true },
    },
    drop: ["identifiers.kind_1_identifiers.value_1"],
  },
  {
    collection: "crm_customers",
    create: {
      key: { companyId: 1, "profile.cpf.hash": 1 },
      options: {
        name: "company_customer_cpf_unique",
        unique: true,
        partialFilterExpression: { "profile.cpf.hash": { $exists: true } },
      },
    },
    drop: ["profile.cpf.hash_1"],
  },
  {
    collection: "calendar_appointments",
    create: {
      key: { companyId: 1, providerId: 1, startAt: 1 },
      options: {
        name: "company_active_appointment_start_unique",
        unique: true,
        partialFilterExpression: { status: { $in: ["held", "scheduled"] } },
      },
    },
    // The second one is an older, narrower variant (scheduled only, per event type) no release creates anymore.
    drop: ["unique_active_appointment_start", "providerId_1_startAt_1_eventType_1"],
  },
];

const client = new MongoClient(process.env.MONGODB_URI, { appName: "oria-migrate-tenant-indexes" });

try {
  await client.connect();
  const db = client.db("ai_secretary");
  const host = new URL(process.env.MONGODB_URI.replace(/^mongodb(\+srv)?:\/\//, "https://")).hostname;
  console.log(`${apply ? "APPLY" : "DRY RUN"} on ${host}/ai_secretary`);

  const missingCompany = {};
  for (const name of new Set(PLAN.map((step) => step.collection))) {
    missingCompany[name] = await db.collection(name).countDocuments({ companyId: { $exists: false } });
    if (missingCompany[name] > 0) {
      throw new Error(`${name}: ${missingCompany[name]} document(s) without companyId; per-company uniqueness would not cover them. Aborting.`);
    }
  }

  for (const step of PLAN) {
    const collection = db.collection(step.collection);
    const indexes = await collection.indexes();
    const present = new Map(indexes.map((index) => [index.name, index]));
    const target = present.get(step.create.options.name);
    console.log(`\n${step.collection}`);
    console.log(`  per-company index ${step.create.options.name}: ${target ? "present" : "missing -> create"}`);
    for (const name of step.drop) console.log(`  global index ${name}: ${present.has(name) ? "present -> drop" : "absent"}`);
    if (!apply) continue;

    if (!target) await collection.createIndex(step.create.key, step.create.options);
    const created = (await collection.indexes()).find((index) => index.name === step.create.options.name);
    if (!created || JSON.stringify(created.key) !== JSON.stringify(step.create.key) || created.unique !== true) {
      throw new Error(`${step.collection}: ${step.create.options.name} is not in place as expected; nothing dropped.`);
    }
    for (const name of step.drop) {
      if (!present.has(name)) continue;
      await collection.dropIndex(name);
      console.log(`  dropped ${name}`);
    }
  }

  if (!apply) console.log("\nNothing written. Re-run with --apply to migrate.");
  else console.log("\nDone. Re-run without --apply to confirm the final state.");
} finally {
  await client.close();
}
