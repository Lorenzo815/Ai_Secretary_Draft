import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config } from "dotenv";
import { MongoClient } from "mongodb";

config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is not configured in .env.local.");
}
if (!process.argv[2]) {
  throw new Error("Usage: node src/scripts/enrich-whatsapp-messages-csv.mjs <export.csv> [output.csv]");
}

const inputFile = path.resolve(process.argv[2]);
const outputFile = path.resolve(process.argv[3] ?? inputFile.replace(/\.csv$/i, "-final.csv"));
const OUTPUT_COLUMNS = ["metaMessageId", "source", "contactPhone", "timestamp", "direction", "body"];
// AI run steps are recorded right after the WhatsApp send, so they match within this window.
const AI_MATCH_WINDOW_MS = 5 * 60 * 1000;

const [header, ...records] = parseCsv((await readFile(inputFile, "utf8")).replace(/^\uFEFF/, ""));
const messages = records
  .filter((record) => record.length > 1)
  .map((record) => Object.fromEntries(header.map((column, index) => [column, unguard(record[index] ?? "")])));

const client = new MongoClient(process.env.MONGODB_URI);
let aiSteps;
try {
  await client.connect();
  aiSteps = await client.db("ai_secretary").collection("assistant_run_steps")
    .find({ "action.message": { $type: "string" } }, { projection: { customerId: 1, "action.message": 1, createdAt: 1 } })
    .toArray();
} finally {
  await client.close();
}

const stepsByKey = new Map();
for (const step of aiSteps) {
  const key = matchKey(String(step.customerId), step.action.message);
  if (!stepsByKey.has(key)) stepsByKey.set(key, []);
  stepsByKey.get(key).push({ time: new Date(step.createdAt).getTime(), used: false });
}

const counts = {};
const rows = messages.map((message) => {
  const source = classify(message);
  counts[source] = (counts[source] ?? 0) + 1;
  return { ...message, source };
});

const csv = [OUTPUT_COLUMNS, ...rows.map((row) => OUTPUT_COLUMNS.map((column) => row[column]))]
  .map((values) => values.map(csvCell).join(","))
  .join("\r\n");
await writeFile(outputFile, `\uFEFF${csv}\r\n`, "utf8");
console.log(JSON.stringify({ outputFile, messages: rows.length, aiRunSteps: aiSteps.length, sources: counts }, null, 2));

function classify(message) {
  if (message.direction === "inbound") return "customer";
  if (message.source === "whatsapp_business_app") return "human_whatsapp_app";
  if (message.sentBy === "Confirmação automática") return "automation_confirmation";
  if (message.sentBy) return "human_dashboard";
  if (matchesAiStep(message)) return "ai";
  if (message.templateName) return "automation_template";
  if (message.body.startsWith("Sinal confirmado")) return "automation_payment";
  return "unknown_outbound";
}

function matchesAiStep(message) {
  const candidates = stepsByKey.get(matchKey(message.customerId, message.body));
  if (!candidates) return false;
  const sentAt = new Date(message.timestamp).getTime();
  let best;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.time - sentAt);
    if (!candidate.used && distance <= AI_MATCH_WINDOW_MS && (!best || distance < best.distance)) {
      best = { candidate, distance };
    }
  }
  if (!best) return false;
  best.candidate.used = true;
  return true;
}

function matchKey(customerId, body) {
  return `${customerId}\u0000${String(body).trim()}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || (char === "\r" && text[index + 1] === "\n")) {
      if (char === "\r") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Reverses the spreadsheet formula guard added by the export script.
function unguard(value) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
