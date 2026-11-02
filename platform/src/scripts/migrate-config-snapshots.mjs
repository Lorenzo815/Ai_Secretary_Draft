// Moves duplicated agent configuration copies out of `assistant_runs` into `assistant_config_snapshots`.
// Dry run by default (read-only). Writes only with --apply.
//   node src/scripts/migrate-config-snapshots.mjs [--apply] [--env path/to/.env]
import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const envIndex = args.indexOf("--env");
const envFile = envIndex >= 0 ? args[envIndex + 1] : ".env.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.MONGODB_URI) throw new Error(`MONGODB_URI not found (env file: ${envFile}).`);

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const client = new MongoClient(process.env.MONGODB_URI, { appName: "oria-migrate-config-snapshots" });

try {
  await client.connect();
  const db = client.db("ai_secretary");
  const runs = db.collection("assistant_runs");
  const snapshots = db.collection("assistant_config_snapshots");
  const host = new URL(process.env.MONGODB_URI.replace(/^mongodb(\+srv)?:\/\//, "https://")).hostname;
  console.log(`${apply ? "APPLY" : "DRY RUN"} on ${host}/ai_secretary`);

  const groups = await runs.aggregate([
    { $match: { configSnapshot: { $exists: true } } },
    { $group: {
      _id: { companyId: "$companyId", configHash: "$configHash" },
      runs: { $sum: 1 },
      bytes: { $sum: { $bsonSize: "$configSnapshot" } },
      latestRevision: { $max: "$configRevision" },
      latestRunId: { $max: "$_id" },
    } },
  ]).toArray();
  const keyOf = (group) => `${group._id.companyId.toHexString()}:${group._id.configHash}`;
  const existing = new Set((await snapshots.find(
    { _id: { $in: groups.map(keyOf) } }, { projection: { _id: 1 } },
  ).toArray()).map((document) => document._id));

  const totalRuns = groups.reduce((sum, group) => sum + group.runs, 0);
  const totalBytes = groups.reduce((sum, group) => sum + group.bytes, 0);
  console.log(`Runs with an embedded copy: ${totalRuns}`);
  console.log(`Distinct configuration versions: ${groups.length} (${existing.size} already in assistant_config_snapshots)`);
  console.log(`Uncompressed data to free: ${mb(totalBytes)}`);
  const invalid = groups.filter((group) => !group._id.companyId || !group._id.configHash);
  if (invalid.length) throw new Error(`${invalid.length} group(s) without companyId or configHash; aborting.`);

  if (!apply) {
    console.log("Nothing written. Re-run with --apply to migrate.");
    process.exit(0);
  }

  let created = 0;
  for (const group of groups) {
    const key = keyOf(group);
    if (existing.has(key)) continue;
    const source = await runs.findOne({ _id: group.latestRunId }, { projection: { configSnapshot: 1, configRevision: 1 } });
    if (!source?.configSnapshot) throw new Error(`Source run ${group.latestRunId} has no snapshot; aborting.`);
    const result = await snapshots.updateOne(
      { _id: key },
      { $setOnInsert: {
        companyId: group._id.companyId,
        configHash: group._id.configHash,
        configRevision: source.configRevision ?? group.latestRevision,
        snapshot: source.configSnapshot,
        createdAt: new Date(),
      } },
      { upsert: true },
    );
    created += result.upsertedCount;
  }
  console.log(`Snapshots created: ${created}`);

  const stored = new Set((await snapshots.find(
    { _id: { $in: groups.map(keyOf) } }, { projection: { _id: 1 } },
  ).toArray()).map((document) => document._id));
  let stripped = 0;
  for (const group of groups) {
    if (!stored.has(keyOf(group))) {
      console.warn(`Skipping ${keyOf(group)}: snapshot not found after upsert.`);
      continue;
    }
    const result = await runs.updateMany(
      { companyId: group._id.companyId, configHash: group._id.configHash, configSnapshot: { $exists: true } },
      { $unset: { configSnapshot: "" } },
    );
    stripped += result.modifiedCount;
  }
  const remaining = await runs.countDocuments({ configSnapshot: { $exists: true } });
  console.log(`Runs updated: ${stripped}. Runs still carrying a copy: ${remaining}.`);
  console.log("Freed space is reused by MongoDB for new data; the on-disk file may not shrink immediately.");
} finally {
  await client.close();
}
