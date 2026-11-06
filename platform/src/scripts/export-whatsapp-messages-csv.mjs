import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { config } from "dotenv";
import { MongoClient } from "mongodb";

config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is not configured in .env.local.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputFile = path.resolve(process.argv[2] ?? path.join(os.homedir(), "Downloads", `oria-whatsapp-messages-${timestamp}.csv`));
const client = new MongoClient(process.env.MONGODB_URI);

const COLUMNS = [
  "timestamp", "companyId", "customerId", "customerName", "contactPhone", "contactName", "direction", "type",
  "status", "body", "mediaMimeType", "mediaFilename", "mediaCaption", "mediaTranscription", "replyToBody",
  "templateName", "selectionTitle", "sentBy", "source", "metaMessageId", "messageId", "updatedAt",
];

try {
  await client.connect();
  const database = client.db("ai_secretary");
  const [messages, customers] = await Promise.all([
    database.collection("whatsapp_messages").find({}).sort({ timestamp: 1 }).toArray(),
    database.collection("crm_customers").find({}, { projection: { name: 1 } }).toArray(),
  ]);
  const customerNames = new Map(customers.map((customer) => [String(customer._id), customer.name ?? ""]));

  const rows = messages.map((message) => ({
    timestamp: toIso(message.timestamp),
    companyId: message.companyId ? String(message.companyId) : "",
    customerId: message.customerId ? String(message.customerId) : "",
    customerName: message.customerId ? customerNames.get(String(message.customerId)) ?? "" : "",
    contactPhone: message.contactPhone,
    contactName: message.contactName,
    direction: message.direction,
    type: message.type,
    status: message.status,
    body: message.body,
    mediaMimeType: message.media?.mimeType,
    mediaFilename: message.media?.filename,
    mediaCaption: message.media?.caption,
    mediaTranscription: message.media?.transcription,
    replyToBody: message.replyTo?.body,
    templateName: message.templateName,
    selectionTitle: message.selection?.title,
    sentBy: message.sentBy,
    source: message.source,
    metaMessageId: message.metaMessageId,
    messageId: String(message._id),
    updatedAt: toIso(message.updatedAt),
  }));

  const csv = [COLUMNS, ...rows.map((row) => COLUMNS.map((column) => row[column]))]
    .map((values) => values.map(csvCell).join(","))
    .join("\r\n");
  // BOM so Excel opens UTF-8 accents correctly.
  await writeFile(outputFile, `\uFEFF${csv}\r\n`, "utf8");
  console.log(JSON.stringify({ outputFile, messages: rows.length }, null, 2));
} finally {
  await client.close();
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value ? String(value) : "";
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formula injection from customer-provided text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
