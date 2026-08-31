import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const enabled = (process.env.ASSISTANT_WORKER_ENABLED ?? "true").toLowerCase() === "true";
const secret = process.env.ASSISTANT_WORKER_SECRET;
const baseUrl = process.env.ASSISTANT_WORKER_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const intervalMs = readBoundedInteger("ASSISTANT_WORKER_INTERVAL_MS", 3_000, 1_000, 60_000);
const timeoutMs = readBoundedInteger("ASSISTANT_WORKER_REQUEST_TIMEOUT_MS", 30_000, 1_000, 120_000);
const processUrl = new URL("/api/internal/assistant/process", baseUrl);

if (!enabled) {
  console.log("Assistant worker is disabled by ASSISTANT_WORKER_ENABLED.");
  process.exit(0);
}
if (!secret) {
  console.error("ASSISTANT_WORKER_SECRET is required.");
  process.exit(1);
}

let stopped = false;
let nextExecution;

console.log(`Assistant worker started: ${processUrl.origin}, interval ${intervalMs}ms.`);
void execute();

async function execute() {
  try {
    const response = await fetch(processUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await response.text();
    if (!response.ok) {
      console.error(`Assistant worker request failed (${response.status}): ${result.slice(0, 500)}`);
    } else {
      const parsed = JSON.parse(result);
      if (parsed.processed > 0) {
        console.log(`Assistant worker processed ${parsed.processed} item(s).`);
      }
    }
  } catch (error) {
    console.error("Assistant worker execution failed:", error instanceof Error ? error.message : error);
  } finally {
    if (!stopped) nextExecution = setTimeout(execute, intervalMs);
  }
}

function shutdown() {
  stopped = true;
  if (nextExecution) clearTimeout(nextExecution);
  console.log("Assistant worker stopped.");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function readBoundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}